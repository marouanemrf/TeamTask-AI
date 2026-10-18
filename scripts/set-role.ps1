<#
.SYNOPSIS
  Changes a TeamTask AI user's role.

.DESCRIPTION
  Permissions come from the user's Cognito group, so this script:
    1. removes the user from every other role group,
    2. adds the user to the requested group,
    3. updates TeamMember.role / roles for the matching email, if a record exists,
    4. keeps the organisation groups right (data isolation, see amplify/functions/shared/tenancy.ts):
       always "<organisationId>", plus "<organisationId>:MANAGERS" for ADMIN and PROJECT_MANAGER.
  Never remove a user from the "<organisationId>" group: without it they see no data at all.
  The user must sign out and sign in again for the new role to apply.

.EXAMPLE
  npm run set-role -- -Email marouanemorfi@gmail.com -Role MEMBER
#>
param(
  [Parameter(Mandatory = $true)][string]$Email,
  [Parameter(Mandatory = $true)][ValidateSet('ADMIN', 'PROJECT_MANAGER', 'MEMBER', 'VIEWER')][string]$Role
)

$ErrorActionPreference = 'Stop'
$roles = @('ADMIN', 'PROJECT_MANAGER', 'MEMBER', 'VIEWER')

# --- Backend identifiers from the deployed sandbox ---
$outputs = Get-Content -Raw -Path (Join-Path $PSScriptRoot '..\amplify_outputs.json') | ConvertFrom-Json
$pool = $outputs.auth.user_pool_id
$region = $outputs.auth.aws_region

function Invoke-Aws {
  $output = & aws @args
  if ($LASTEXITCODE -ne 0) { throw "aws $($args[0]) $($args[1]) failed (exit $LASTEXITCODE)" }
  return $output
}

# --- Cognito: find the user (email is the sign-in alias, so admin APIs accept it as username) ---
$username = Invoke-Aws cognito-idp admin-get-user --user-pool-id $pool --region $region `
  --username $Email --query 'Username' --output text

# --- Cognito: switch groups ---
$current = (Invoke-Aws cognito-idp admin-list-groups-for-user --user-pool-id $pool --region $region `
  --username $username --query 'Groups[].GroupName' --output text) -split '\s+' | Where-Object { $_ }

foreach ($group in $current) {
  if ($roles -contains $group -and $group -ne $Role) {
    Invoke-Aws cognito-idp admin-remove-user-from-group --user-pool-id $pool --region $region `
      --username $username --group-name $group | Out-Null
    Write-Host "Removed from $group"
  }
}
if ($current -notcontains $Role) {
  Invoke-Aws cognito-idp admin-add-user-to-group --user-pool-id $pool --region $region `
    --username $username --group-name $Role | Out-Null
  Write-Host "Added to $Role"
} else {
  Write-Host "Already in $Role"
}

# --- DynamoDB: keep TeamMember.role in sync (informational field) ---
$table = Invoke-Aws dynamodb list-tables --region $region --query "TableNames[?starts_with(@, 'TeamMember-')] | [0]" --output text
if ($table -and $table -ne 'None') {
  $values = @{ ':e' = @{ S = $Email } } | ConvertTo-Json -Compress
  $valuesFile = New-TemporaryFile
  Set-Content -Path $valuesFile -Value $values -Encoding Ascii
  $ids = (Invoke-Aws dynamodb scan --table-name $table --region $region --filter-expression 'email = :e' `
      --expression-attribute-values "file://$valuesFile" --query 'Items[].id.S' --output text) -split '\s+' | Where-Object { $_ }
  $orgs = (Invoke-Aws dynamodb scan --table-name $table --region $region --filter-expression 'email = :e' `
      --expression-attribute-values "file://$valuesFile" --query 'Items[].organisationId.S' --output text) -split '\s+' | Where-Object { $_ -and $_ -ne 'None' }
  Remove-Item $valuesFile

  foreach ($id in $ids) {
    $key = @{ id = @{ S = $id } } | ConvertTo-Json -Compress
    $update = @{ ':r' = @{ S = $Role }; ':rs' = @{ L = @(@{ S = $Role }) }; ':u' = @{ S = (Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ss.fffZ') } } | ConvertTo-Json -Compress -Depth 5
    $keyFile = New-TemporaryFile; $updateFile = New-TemporaryFile
    Set-Content -Path $keyFile -Value $key -Encoding Ascii
    Set-Content -Path $updateFile -Value $update -Encoding Ascii
    Invoke-Aws dynamodb update-item --table-name $table --region $region --key "file://$keyFile" `
      --update-expression 'SET #r = :r, #rs = :rs, updatedAt = :u' --expression-attribute-names '{\"#r\":\"role\",\"#rs\":\"roles\"}' `
      --expression-attribute-values "file://$updateFile" | Out-Null
    Remove-Item $keyFile, $updateFile
    Write-Host "TeamMember $id role set to $Role"
  }
  if (-not $ids) { Write-Host "No TeamMember record for $Email (only the Cognito group was changed)" }

  # --- Organisation groups (data isolation) ---
  foreach ($org in ($orgs | Select-Object -Unique)) {
    & aws cognito-idp create-group --user-pool-id $pool --region $region --group-name $org 2>$null | Out-Null
    Invoke-Aws cognito-idp admin-add-user-to-group --user-pool-id $pool --region $region --username $username --group-name $org | Out-Null
    $managers = "${org}:MANAGERS"
    if ($Role -eq 'ADMIN' -or $Role -eq 'PROJECT_MANAGER') {
      & aws cognito-idp create-group --user-pool-id $pool --region $region --group-name $managers 2>$null | Out-Null
      Invoke-Aws cognito-idp admin-add-user-to-group --user-pool-id $pool --region $region --username $username --group-name $managers | Out-Null
    } else {
      & aws cognito-idp admin-remove-user-from-group --user-pool-id $pool --region $region --username $username --group-name $managers 2>$null | Out-Null
    }
    Write-Host "Organisation groups kept for $org"
  }
}

Write-Host ""
Write-Host "Done: $Email is now $Role. Sign out and sign in again for it to take effect."

# TeamTask AI — Security test report (proposal step 7)

**Status: the live suite is written but has not run yet.** The AWS session of this workstation
expired, so nothing could be deployed or called. Static checks and unit-level permission tests ran.
Re-run with the commands at the end; `npm run security:report` regenerates every table below from
the results.

**Scope.** Tests target what is deployed: AppSync + Lambda task API, Cognito, the profile-photo S3
bucket and, once deployed, the assistant (`POST /assistant/chat` on API Gateway, Bedrock Agent,
`assistant-tools`). Categories that need components not built yet (Step Functions approvals,
Bedrock planner, attachments bucket, scheduler DLQ, CloudTrail trail) are recorded as **N/A** with
the reason, never as passes.

## 1. Summary

| Category | Tests | Pass | Fail | N/A | Run? |
|---|---:|---:|---:|---:|---|
| a. Authentication (no / expired / tampered token, 12 operations) | 36 | – | – | – | not run |
| b. Role matrix (17 operations × 4 roles + 2) | 70 | – | – | – | not run |
| c. Cross-tenant (14 by id + 3 lists + integrity) | 18 | – | – | – | not run |
| d. Input validation | 13 | – | – | – | not run |
| e. Idempotency | 3 | – | – | – | not run |
| f. Audit immutability (API + IAM simulation) | 4+ | – | – | – | not run |
| g. Approval bypass (current stack) | 6 | – | – | – | not run |
| h/i. Planner agent: prompt injection, unintended actions | 2 | – | – | 2 | N/A (planner not built) |
| j. S3 | 5 | – | – | 1 | not run |
| k. Notifications | 2 | – | – | 1 | not run |
| l. Logging | 3 | – | – | – | not run |
| m. Assistant — tools by direct invocation | 10 | – | – | – | not run |
| m. Assistant — chat endpoint | 6 | – | – | – | not run |
| Static: npm audit, secrets, IAM in code | 3 | 2 | 1 | – | **run** |
| Unit: assistant permission matrix (tool × role) + isolation + cards | 67 | 67 | 0 | – | **run** |
| Unit: assistant chat (identity, body, session, stream) | 8 | 8 | 0 | – | **run** |

## 2. Results of what ran

### Static checks

| Check | Result |
|---|---|
| `npm audit` | 51 advisories (4 critical, 44 high, 3 moderate), **all in development tooling** (Amplify CLI/CDK, GraphQL codegen, handlebars, lodash, micromatch…). `npm audit --omit=dev`: **0**. Nothing ships to the browser or the Lambdas from these. → FAIL (tooling), low runtime risk |
| Secrets in the repository | No AWS keys, private keys, tokens or passwords; no `.env` files (`.env*` git-ignored). Test passwords come only from the environment. → PASS |
| IAM wildcards in our infrastructure code | None: every statement names its resources. Deployed Amplify-generated roles are scanned by the live suite ("Static: IAM wildcards"). → PASS (code) |

### Assistant permission matrix (unit, `amplify/functions/assistant-tools/tools.test.ts`)

Every tool × every role returns OK or FORBIDDEN exactly as in the README matrix (44 cases); every
tool given another organisation's id returns FORBIDDEN for every role; an unknown id and a foreign
id give byte-identical answers (no existence leak); no list ever contains another organisation's
data; an `orgId` passed as a tool parameter is ignored; MEMBER limits (own projects, limited fields,
own risks), VIEWER aggregates only, PM/ADMIN organisation-scoped workload, escalations, audit and
activity; cards: VIEWER none, MEMBER own task only, blocker reason ≥ 10 characters, dependency rule,
assignee in the organisation and assignable, valid dates, closed tasks refused.

### Assistant chat (unit, `amplify/functions/assistant-chat/chatCore.test.ts`)

Identity from claims only (highest group; no group = VIEWER); `sessionAttributes`, `role`, `orgId`
in the body are dropped; 2,000-character limit; malformed context ids ignored; session ids differ
per user and per conversation; action cards are taken only from tool outputs, never from model text.

## 3. Fixes applied

| # | Finding | Fix | Files |
|---|---|---|---|
| 1 | **Assistant tools trusted the data source to filter tasks by project** (found by the isolation unit tests: org B tasks appeared in org A answers) | Tools filter every task by the organisation's projects themselves | `amplify/functions/assistant-tools/tools.ts` |
| 2 | Dependency links writable directly by managers (bypassing cycle/same-project rules) | Read-only for clients | `amplify/data/resource.ts` |
| 3 | Idempotency check-then-write not atomic | Deterministic event ids (`requestId:type`) and task id = requestId with conditional create | `shared/audit.ts`, `create-task/handler.ts` |
| 4 | Escalation resolution without idempotency or task audit; small `limit` before `filter` | clientRequestId, ASSIGNED/UPDATED events, paginated member lookup, assignability rule | `resolve-escalation/handler.ts`, `shared/data.ts` |
| 5 | Personal email hard-coded as SES sender | Amplify secrets (SSM Parameter Store) | `deadline-check`, `weekly-report`, `backend.ts` |
| 6 | Group users couldn't use their own photo folder; any user could reference another's photo | Own-folder write for every group role; path check | `backend.ts`, `storage/resource.ts`, `manage-profile/handler.ts` |
| 7 | Job title editable by anyone through the API | Server ignores job title changes except for ADMIN | `manage-profile/handler.ts` |
| 8 | Assignment to read-only (VIEWER) members or to nobody | Required assignee who can hold tasks, checked on the server | `create-task`, `update-task`, `assign-task`, `shared/rules.ts` |

## 4. Remaining risks (expected to show as FAIL in the live run)

| Risk | Severity | Recommendation |
|---|---|---|
| Cross-tenant **reads** through AppSync: any signed-in user can list projects, tasks and members of every organisation (no tenant ID on tasks) | High | Phase 2 of the plan: API Gateway + Lambda with an orgId on every record, checked on every operation. Until then, run a single organisation per deployment |
| Cross-tenant **writes** on Project/Milestone/AIRecommendation/Approval models by any PROJECT_MANAGER | High | Route these writes through Lambdas with organisation checks (phase 2); make AIRecommendation/Approval read-only for clients now (unused by the UI) |
| Task Lambdas don't check that the caller belongs to the project's organisation | High | Add a caller-organisation check in the shared task handler (cheap fix, planned with the live run) |
| Functions have full AppSync IAM access (could delete TaskEvents) | Medium | Separate append-only events table with PutItem/Query only (phase 2) |
| Profile-photo uploads: any type and size into the user's own folder; photos readable across organisations | Low | Validate type/size with HeadObject on profile save; prefix photos by organisation |
| No CloudTrail trail with data events, no CloudWatch alarms or scheduler DLQ | Medium | Phase 5 |
| Assistant uses table scans (cost grows with data) | Low | Query by indexes after the single-table migration |
| Dev-tooling advisories (npm audit) | Low | Upgrade `@aws-amplify/backend` / CLI when fixed versions are released |

## 5. How to run

```bash
aws login                                             # credentials for the sandbox account
npx ampx sandbox secret set SENDER_EMAIL && npx ampx sandbox secret set APP_URL
npm run deploy:sandbox                                # must print "Deployment completed"
export SEC_TEST_PASSWORD='<8+ chars, upper, lower, digit, symbol>'   # never committed
npm run security:setup                                # 5 test users, org B, fixtures
npm run test:security                                 # live suite → tests/security/.results.jsonl
npm run security:report                               # tables for this report
npm test                                              # unit tests (incl. assistant matrix)
```

// Demo data set covering every scenario of the app (fake people, clients and projects).
// - 8 members with sign-in accounts (@gogosecurity.test, no invitation email), 3 teams;
// - 6 projects (active, on hold, closed, draft) with tasks in every status, dependencies,
//   milestones, an overloaded member, a member with spare capacity and one on planned leave;
// - overdue tasks with OPEN escalations, resolved escalations, sent reminders, blockers;
// - the audit trail (TaskEvent) that matches all of the above.
// Every id starts with "demo-": scripts/remove-demo-scenarios.mjs deletes the data set.
// Idempotent: existing records are left as they are.
//
// Usage: DEMO_PASSWORD='…' node scripts/seed-demo-scenarios.mjs <path to amplify_outputs.json>
import { readFileSync } from "node:fs";
import { AppSyncClient, ListGraphqlApisCommand } from "@aws-sdk/client-appsync";
import {
  AdminAddUserToGroupCommand,
  AdminCreateUserCommand,
  AdminGetUserCommand,
  AdminSetUserPasswordCommand,
  CognitoIdentityProviderClient,
  CreateGroupCommand,
} from "@aws-sdk/client-cognito-identity-provider";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, PutCommand, ScanCommand } from "@aws-sdk/lib-dynamodb";

const password = process.env.DEMO_PASSWORD;
if (!password) throw new Error("Set DEMO_PASSWORD (the password of every demo account).");
const outputs = JSON.parse(readFileSync(process.argv[2] ?? new URL("../amplify_outputs.json", import.meta.url), "utf8"));
const region = outputs.auth.aws_region;
const userPoolId = outputs.auth.user_pool_id;

const apis = await new AppSyncClient({ region }).send(new ListGraphqlApisCommand({}));
const api = apis.graphqlApis.find((a) => a.uris?.GRAPHQL === outputs.data.url);
if (!api) throw new Error(`No AppSync API found for ${outputs.data.url}`);
const table = (model) => `${model}-${api.apiId}-NONE`;
const db = DynamoDBDocumentClient.from(new DynamoDBClient({ region }), { marshallOptions: { removeUndefinedValues: true } });

const scanAll = async (model) => {
  const items = [];
  let ExclusiveStartKey;
  do {
    const page = await db.send(new ScanCommand({ TableName: table(model), ExclusiveStartKey }));
    items.push(...(page.Items ?? []));
    ExclusiveStartKey = page.LastEvaluatedKey;
  } while (ExclusiveStartKey);
  return items;
};

let created = 0;
let skipped = 0;
async function put(model, item) {
  const at = item.createdAt ?? new Date().toISOString();
  try {
    await db.send(new PutCommand({
      TableName: table(model),
      Item: { __typename: model, createdAt: at, updatedAt: item.updatedAt ?? at, ...item },
      ConditionExpression: "attribute_not_exists(id)",
    }));
    created++;
  } catch (error) {
    if (error.name !== "ConditionalCheckFailedException") throw error;
    skipped++;
  }
}

const at = (day, time = "09:00") => `${day}T${time}:00.000Z`;
const addDays = (day, n) => new Date(Date.parse(`${day}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);


// --- Organisation: the existing one (created at the first admin sign-in) ---
const [organisation] = await scanAll("Organisation");
if (!organisation) throw new Error("No organisation found: sign in once as ADMIN first.");
const orgId = organisation.id;

// --- People ---
const MEMBERS = {
  youssef: { name: "Youssef Benali", role: "PROJECT_MANAGER", jobTitle: "Engagement Manager", team: "grc", capacity: 40, skills: ["Project management", "GRC", "ISO 27001", "Reporting"] },
  salma: { name: "Salma Tazi", role: "PROJECT_MANAGER", jobTitle: "Delivery Manager", team: "offsec", capacity: 40, skills: ["Project management", "Cloud security", "Reporting"] },
  karim: { name: "Karim Alaoui", role: "MEMBER", jobTitle: "Senior GRC Consultant", team: "grc", capacity: 32, skills: ["ISO 27001", "GRC", "Risk analysis", "Reporting"] },
  sara: { name: "Sara Bennani", role: "MEMBER", jobTitle: "Penetration Tester", team: "offsec", capacity: 40, skills: ["Pentest", "Web security", "Vulnerability management", "API security"] },
  lina: { name: "Lina Chraibi", role: "MEMBER", jobTitle: "Cloud Security Engineer", team: "cloud", capacity: 40, skills: ["AWS security", "IAM", "Cloud security", "KMS"], away: ["2026-10-20", "2026-10-24"] },
  omar: { name: "Omar Fassi", role: "MEMBER", jobTitle: "SOC Analyst", team: "cloud", capacity: 40, skills: ["Incident response", "SIEM", "Threat hunting", "Reporting"] },
  nadia: { name: "Nadia Berrada", role: "MEMBER", jobTitle: "Risk Analyst", team: "grc", capacity: 24, skills: ["Risk analysis", "Incident response", "GRC"] },
  hamza: { name: "Hamza Kettani", role: "VIEWER", jobTitle: "Client Account Director", team: null, capacity: undefined, skills: [] },
};
const email = (key) => `${key}@gogosecurity.test`;
const memberId = (key) => `demo-mbr-${key}`;

const cognito = new CognitoIdentityProviderClient({ region });
for (const [key, m] of Object.entries(MEMBERS)) {
  let username;
  try {
    username = (await cognito.send(new AdminGetUserCommand({ UserPoolId: userPoolId, Username: email(key) }))).Username;
  } catch (error) {
    if (error.name !== "UserNotFoundException") throw error;
    username = (await cognito.send(new AdminCreateUserCommand({
      UserPoolId: userPoolId,
      Username: email(key),
      MessageAction: "SUPPRESS",
      UserAttributes: [
        { Name: "email", Value: email(key) },
        { Name: "email_verified", Value: "true" },
        { Name: "name", Value: m.name },
      ],
    }))).User.Username;
    await cognito.send(new AdminSetUserPasswordCommand({ UserPoolId: userPoolId, Username: username, Password: password, Permanent: true }));
    console.log("Account created:", email(key), m.role);
  }
  // Role group, plus the organisation groups that isolate the organisation's data.
  for (const group of [m.role, orgId, ...(m.role === "PROJECT_MANAGER" ? [`${orgId}:MANAGERS`] : [])]) {
    await cognito.send(new CreateGroupCommand({ UserPoolId: userPoolId, GroupName: group })).catch((e) => { if (e.name !== "GroupExistsException") throw e; });
    await cognito.send(new AdminAddUserToGroupCommand({ UserPoolId: userPoolId, Username: username, GroupName: group }));
  }
  m.username = username;
}

const TEAMS = {
  grc: { name: "GRC", description: "Governance, risk and compliance (ISO 27001, policies, risk).", lead: "karim" },
  offsec: { name: "Offensive security", description: "Penetration tests and vulnerability assessments.", lead: "sara" },
  cloud: { name: "Cloud & SOC", description: "Cloud security reviews, detection and incident response.", lead: "lina" },
};
for (const [key, t] of Object.entries(TEAMS)) {
  await put("Team", { id: `demo-team-${key}`, organisationId: orgId, name: t.name, description: t.description, leadMemberId: memberId(t.lead), createdAt: at("2026-08-01") });
}
for (const [key, m] of Object.entries(MEMBERS)) {
  await put("TeamMember", {
    id: memberId(key),
    organisationId: orgId,
    name: m.name,
    email: email(key),
    username: m.username,
    role: m.role,
    roles: [m.role],
    jobTitle: m.jobTitle,
    skills: m.skills,
    weeklyCapacityHours: m.capacity,
    teamId: m.team ? `demo-team-${m.team}` : undefined,
    unavailableFrom: m.away?.[0],
    unavailableUntil: m.away?.[1],
    professionalSummary: `${m.jobTitle} at Gogo Security (demo profile).`,
    createdAt: at("2026-08-01"),
  });
}

// --- Projects ---
const PROJECTS = {
  acme: { name: "Acme Bank – ISO 27001 readiness", client: "Acme Bank", status: "ACTIVE", impact: "CRITICAL", pm: "youssef", start: "2026-09-21", end: "2026-11-13", objective: "Prepare Acme Bank for its ISO 27001 certification audit: gap analysis, Statement of Applicability, policies and risk treatment." },
  atlas: { name: "Atlas Retail – Web application pentest", client: "Atlas Retail", status: "ACTIVE", impact: "HIGH", pm: "salma", start: "2026-10-05", end: "2026-10-30", objective: "Grey-box penetration test of the e-commerce site and its public API, with a retest of critical findings." },
  nova: { name: "Nova Health – AWS security review", client: "Nova Health", status: "ACTIVE", impact: "HIGH", pm: "salma", start: "2026-10-12", end: "2026-11-20", objective: "Review the AWS landing zone: IAM, data protection (S3, KMS), logging and detection, network segmentation." },
  orion: { name: "Orion Logistics – Incident response playbooks", client: "Orion Logistics", status: "ON_HOLD", impact: "MEDIUM", pm: "youssef", start: "2026-09-28", end: "2026-11-27", objective: "Write ransomware and phishing playbooks and run a tabletop exercise. On hold: client budget review." },
  sahara: { name: "Sahara Telecom – Vulnerability management program", client: "Sahara Telecom", status: "CLOSED", impact: "MEDIUM", pm: "salma", start: "2026-08-03", end: "2026-09-30", objective: "Set up a vulnerability management process: scanning, triage, patch SLAs and reporting." },
  medina: { name: "Medina Insurance – SOC maturity assessment", client: "Medina Insurance", status: "DRAFT", impact: "LOW", pm: "youssef", start: "2026-11-02", end: "2026-12-18", objective: "Assess the maturity of the client's SOC (people, process, technology) against SOC-CMM and propose a roadmap." },
};
for (const [key, p] of Object.entries(PROJECTS)) {
  await put("Project", { id: `demo-prj-${key}`, organisationId: orgId, name: p.name, clientName: p.client, objective: p.objective, status: p.status, startDate: p.start, endDate: p.end, managerEmail: email(p.pm), businessImpact: p.impact, createdAt: at(addDays(p.start, -7)) });
}

const MILESTONES = [
  ["acme", "Gap analysis delivered", "2026-10-17"],
  ["acme", "Statement of Applicability approved", "2026-10-31"],
  ["acme", "Readiness report delivered", "2026-11-13"],
  ["atlas", "Testing complete", "2026-10-23"],
  ["atlas", "Report delivered", "2026-10-30"],
  ["nova", "Findings workshop", "2026-11-12"],
  ["sahara", "Program handed over", "2026-09-25"],
];
for (const [i, [project, name, dueDate]] of MILESTONES.entries()) {
  await put("Milestone", { id: `demo-ms-${project}-${i}`, organisationId: orgId, projectId: `demo-prj-${project}`, name, dueDate, createdAt: at(PROJECTS[project].start) });
}

// --- Tasks: [key, project, title, status, priority, due, hours, assignee, skills, dependsOn, blockerReason] ---
const TASKS = [
  ["acme-kickoff", "acme", "Kick-off and scope validation", "DONE", "HIGH", "2026-09-23", 4, "youssef", ["Project management"], []],
  ["acme-inventory", "acme", "Asset and data inventory", "DONE", "HIGH", "2026-10-02", 12, "nadia", ["Risk analysis"], ["acme-kickoff"]],
  ["acme-workshop", "acme", "Risk assessment workshop", "DONE", "MEDIUM", "2026-10-09", 8, "nadia", ["Risk analysis", "GRC"], ["acme-inventory"]],
  ["acme-gap", "acme", "ISO 27001 gap analysis", "IN_PROGRESS", "CRITICAL", "2026-10-14", 16, "karim", ["ISO 27001", "GRC"], ["acme-inventory"]],
  ["acme-soa", "acme", "Statement of Applicability draft", "TODO", "HIGH", "2026-10-24", 10, "karim", ["ISO 27001"], ["acme-gap"]],
  ["acme-policies", "acme", "Policy set review (12 policies)", "BLOCKED", "HIGH", "2026-10-21", 8, "karim", ["GRC"], [], "Waiting for the client's current policy documents."],
  ["acme-treatment", "acme", "Risk treatment plan", "TODO", "MEDIUM", "2026-10-28", 8, "nadia", ["Risk analysis"], ["acme-workshop"]],
  ["acme-report", "acme", "Final readiness report", "TODO", "HIGH", "2026-11-10", 6, "youssef", ["Reporting"], ["acme-gap", "acme-soa", "acme-treatment"]],
  ["acme-exec", "acme", "Executive presentation", "TODO", "MEDIUM", "2026-11-13", 3, "youssef", ["Reporting"], ["acme-report"]],

  ["atlas-roe", "atlas", "Rules of engagement signed", "DONE", "HIGH", "2026-10-06", 2, "salma", ["Project management"], []],
  ["atlas-recon", "atlas", "Reconnaissance and attack surface mapping", "DONE", "MEDIUM", "2026-10-09", 8, "sara", ["Pentest"], ["atlas-roe"]],
  ["atlas-auth", "atlas", "Authentication and session testing", "DONE", "HIGH", "2026-10-14", 12, "sara", ["Pentest", "Web security"], ["atlas-recon"]],
  ["atlas-injection", "atlas", "Injection and business logic testing", "IN_PROGRESS", "HIGH", "2026-10-20", 10, "sara", ["Pentest", "Web security"], ["atlas-recon"]],
  ["atlas-api", "atlas", "API security testing", "TODO", "HIGH", "2026-10-23", 6, "sara", ["API security"], ["atlas-recon"]],
  ["atlas-retest", "atlas", "Retest of critical findings", "TODO", "MEDIUM", "2026-10-28", 6, null, ["Pentest"], ["atlas-injection"]],
  ["atlas-report", "atlas", "Penetration test report", "TODO", "HIGH", "2026-10-30", 8, "omar", ["Reporting"], ["atlas-injection", "atlas-api"]],

  ["nova-kickoff", "nova", "Kick-off with the cloud team", "DONE", "MEDIUM", "2026-10-13", 2, "salma", ["Project management"], []],
  ["nova-inventory", "nova", "Collect the AWS account inventory", "TODO", "HIGH", "2026-10-15", 3, "omar", ["AWS security"], ["nova-kickoff"]],
  ["nova-cloudtrail-export", "nova", "Export CloudTrail logs from the client", "TODO", "MEDIUM", "2026-10-17", 2, "omar", ["SIEM"], []],
  ["nova-iam", "nova", "IAM policy review", "IN_PROGRESS", "CRITICAL", "2026-10-30", 12, "lina", ["IAM", "AWS security"], []],
  ["nova-s3kms", "nova", "S3 and KMS configuration review", "TODO", "HIGH", "2026-11-06", 8, "lina", ["KMS", "AWS security"], ["nova-inventory"]],
  ["nova-detection", "nova", "CloudTrail and GuardDuty coverage", "TODO", "MEDIUM", "2026-10-27", 6, "omar", ["SIEM", "AWS security"], ["nova-cloudtrail-export"]],
  ["nova-hub", "nova", "Security Hub findings triage", "BLOCKED", "HIGH", "2026-10-22", 6, "omar", ["AWS security"], [], "Read-only access to the client's AWS accounts is not granted yet."],
  ["nova-network", "nova", "Network segmentation review", "TODO", "MEDIUM", "2026-11-10", 8, null, ["Cloud security"], []],
  ["nova-report", "nova", "Findings report and workshop", "TODO", "HIGH", "2026-11-18", 6, "salma", ["Reporting"], ["nova-iam", "nova-s3kms", "nova-detection"]],

  ["orion-interviews", "orion", "Current incident process interviews", "DONE", "MEDIUM", "2026-10-02", 6, "omar", ["Incident response"], []],
  ["orion-ransomware", "orion", "Ransomware playbook", "TODO", "HIGH", "2026-11-20", 6, "nadia", ["Incident response"], ["orion-interviews"]],
  ["orion-phishing", "orion", "Phishing playbook", "TODO", "MEDIUM", "2026-11-25", 4.5, "karim", ["Incident response", "GRC"], ["orion-interviews"]],
  ["orion-tabletop", "orion", "Tabletop exercise", "CANCELLED", "LOW", "2026-11-27", 8, null, ["Incident response"], []],

  ["sahara-scanner", "sahara", "Scanner deployment and asset discovery", "DONE", "HIGH", "2026-08-14", 16, "sara", ["Vulnerability management"], []],
  ["sahara-triage", "sahara", "Triage process and patch SLAs", "DONE", "HIGH", "2026-08-28", 12, "karim", ["GRC", "Vulnerability management"], ["sahara-scanner"]],
  ["sahara-dashboard", "sahara", "Vulnerability dashboard", "DONE", "MEDIUM", "2026-09-11", 10, "omar", ["Reporting"], ["sahara-scanner"]],
  ["sahara-patch", "sahara", "Patch compliance report", "DONE", "MEDIUM", "2026-09-29", 6, "nadia", ["Reporting", "Risk analysis"], ["sahara-triage", "sahara-dashboard"]],
];
// Finished after an escalation (see ESCALATIONS below).
const DONE_ON = { "orion-interviews": "2026-10-07", "sahara-patch": "2026-09-29" };
const TODAY = new Date().toISOString().slice(0, 10);
const taskId = (key) => `demo-task-${key}`;
const taskByKey = new Map(TASKS.map((t) => [t[0], t]));

let n = 0;
const event = async (key, eventType, day, time, actor, before, after, actorType = "USER") => {
  const id = `demo-evt-${String(++n).padStart(3, "0")}-${key}`;
  await put("TaskEvent", { id: `${id}:${eventType}`, organisationId: orgId, entityId: taskId(key), eventType, actorType, actorEmail: actor ? email(actor) : undefined, before, after, requestId: id, createdAt: at(day, time) });
};

for (const [key, project, title, status, priority, dueDate, hours, assignee, skills, deps, reason] of TASKS) {
  const p = PROJECTS[project];
  const createdDay = p.start;
  await put("Task", {
    id: taskId(key), organisationId: orgId, projectId: `demo-prj-${project}`, title, description: `${title} for ${p.client}.`, status, priority, dueDate,
    estimatedHours: hours, requiredSkills: skills, createdBy: "HUMAN", assigneeId: assignee ? memberId(assignee) : undefined,
    createdAt: at(createdDay), updatedAt: at(createdDay),
  });
  await event(key, "CREATED", createdDay, "09:00", p.pm, undefined, { title, status: "TODO", priority, dueDate, estimatedHours: hours });
  if (assignee) await event(key, "ASSIGNED", createdDay, "09:05", p.pm, { assigneeId: null }, { assigneeId: memberId(assignee) });
  for (const dep of deps) {
    await put("Dependency", { id: `demo-dep-${key}--${dep}`, organisationId: orgId, fromTaskId: taskId(key), toTaskId: taskId(dep), type: "FINISH_TO_START", createdAt: at(createdDay) });
  }
  const actor = assignee ?? p.pm;
  const min = (a, b) => (a < b ? a : b);
  const max = (a, b) => (a > b ? a : b);
  const started = max(createdDay, min(addDays(dueDate, -4), TODAY));
  if (status === "IN_PROGRESS" || status === "DONE" || status === "BLOCKED") {
    await event(key, "STATUS_CHANGED", started, "10:00", actor, { status: "TODO" }, { status: "IN_PROGRESS" });
  }
  if (status === "DONE") await event(key, "STATUS_CHANGED", DONE_ON[key] ?? min(dueDate, TODAY), "16:30", actor, { status: "IN_PROGRESS" }, { status: "DONE" });
  if (status === "BLOCKED") await event(key, "STATUS_CHANGED", "2026-10-16", "11:20", actor, { status: "IN_PROGRESS" }, { status: "BLOCKED", reason });
  if (status === "CANCELLED") await event(key, "STATUS_CHANGED", "2026-10-12", "14:00", p.pm, { status: "TODO" }, { status: "CANCELLED" });
}

// --- Reminders already sent by the daily check (history; the demo addresses can't receive mail) ---
const REMINDERS = [
  ["acme-gap", "karim", "2026-10-12"], ["acme-gap", "karim", "2026-10-15"], ["acme-gap", "youssef", "2026-10-17"],
  ["atlas-injection", "sara", "2026-10-18"], ["atlas-auth", "sara", "2026-10-12"],
  ["nova-inventory", "omar", "2026-10-13"], ["nova-inventory", "omar", "2026-10-16"], ["nova-inventory", "salma", "2026-10-18"],
  ["nova-cloudtrail-export", "omar", "2026-10-15"], ["nova-cloudtrail-export", "omar", "2026-10-18"],
  ["sahara-patch", "nadia", "2026-09-21"], ["sahara-patch", "nadia", "2026-09-24"], ["sahara-patch", "salma", "2026-09-26"],
];
for (const [i, [key, who, day]] of REMINDERS.entries()) {
  await put("Reminder", { id: `demo-rem-${i}`, organisationId: orgId, managersGroup: `${orgId}:MANAGERS`, taskId: taskId(key), recipientEmail: email(who), channel: "EMAIL", scheduledAt: at(day, "07:00"), sentAt: at(day, "07:00"), status: "SENT", createdAt: at(day, "07:00") });
}

// --- Escalations: two open, two resolved (one deadline extension, one accepted delay) ---
const impactedOf = (key) => TASKS.filter((t) => t[9].includes(key)).map((t) => t[2]);
const reasonFor = (key, days) => {
  const impacted = impactedOf(key);
  return `${days} day(s) overdue. ${impacted.length ? `Blocked tasks: ${impacted.join(", ")}.` : "No dependent tasks found."}`;
};
const ESCALATIONS = [
  ["acme-gap", "OPEN", "2026-10-17", 3],
  ["nova-inventory", "OPEN", "2026-10-18", 3],
  ["sahara-patch", "RESOLVED", "2026-09-26", 3, "EXTEND_DEADLINE", "salma", "The client's patch data arrived late; two more days agreed."],
  ["orion-interviews", "RESOLVED", "2026-10-05", 3, "ACCEPT_DELAY", "youssef", "Interviews depend on the client's availability; delay accepted."],
];
for (const [key, status, day, days, decision, manager, comment] of ESCALATIONS) {
  const id = `demo-esc-${key}`;
  const reason = reasonFor(key, days);
  await put("Escalation", { id, organisationId: orgId, managersGroup: `${orgId}:MANAGERS`, taskId: taskId(key), reason, level: 1, status, createdAt: at(day, "07:00"), updatedAt: at(status === "OPEN" ? day : addDays(day, 1), status === "OPEN" ? "07:00" : "10:15") });
  await event(key, "ESCALATED", day, "07:00", null, undefined, { escalationId: id, reason, impacted: impactedOf(key) }, "SYSTEM");
  if (status !== "RESOLVED") continue;
  const task = taskByKey.get(key);
  // The task's current due date is the extended one: it was 6 days earlier.
  if (decision === "EXTEND_DEADLINE") await event(key, "UPDATED", addDays(day, 1), "10:10", manager, { dueDate: addDays(task[5], -6) }, { dueDate: task[5], escalationId: id });
  await event(key, "APPROVED", addDays(day, 1), "10:15", manager, { escalationId: id }, { escalationId: id, decision, comment });
}

console.log(`Done: ${created} record(s) created, ${skipped} already there.`);

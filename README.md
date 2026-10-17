# TeamTask AI — Gogo Security

Task management for a cybersecurity consulting team: projects, Kanban, workload, reminders and
escalations, weekly reports, and a role-aware AI assistant.

## Architecture (defined in the repository)

```mermaid
flowchart LR
  U[Browser — React + TypeScript + Vite] -->|Cognito tokens| COG[Amazon Cognito<br/>groups ADMIN / PROJECT_MANAGER / MEMBER / VIEWER]
  U -->|GraphQL| APPSYNC[AWS AppSync]
  U -->|POST /assistant/chat (stream)| APIGW[API Gateway REST<br/>Cognito authorizer, throttling]
  APPSYNC --> DDB[(Amazon DynamoDB<br/>one table per model)]
  APPSYNC --> L1[Lambda task API<br/>create / edit / assign / status / cancel<br/>rules · idempotency · audit]
  L1 --> DDB
  APIGW --> CHAT[Lambda assistant-chat<br/>identity from token · rate limit]
  CHAT --> AGENT[Amazon Bedrock Converse API<br/>tool use + Guardrail]
  CHAT --> TOOLS[Lambda assistant-tools<br/>read-only · organisation-scoped]
  TOOLS --> DDB
  SCHED[EventBridge Scheduler<br/>deadline-check · weekly-report] --> DDB
  SCHED --> SES[Amazon SES]
  U -->|profile photos and task attachments| S3[(Amazon S3)]
  PLAN[AI planning Lambda] -->|start / decision| SFN[Step Functions approval workflow]
  SFN --> PLAN
  TE[TaskEvent DynamoDB stream] --> ARCHIVE[S3 Object Lock audit archive]
  OPS[CloudTrail · KMS · CloudWatch alarms/dashboard] -. monitors .-> APIGW
```

The repository defines Step Functions approval for AI task plans, AI weekly reports, EventBridge
Scheduler retries and dead-letter handling, CloudTrail, a KMS-encrypted Object Lock audit archive,
and CloudWatch alarms and a dashboard. The assistant and planner use Bedrock Converse with tool use;
the classic Bedrock Agents service is not used. AppSync remains the web application's GraphQL data
API; API Gateway provides task REST routes and assistant endpoints. This diagram describes source
code and does not assert that the latest version is deployed.

There is no verified live pilot or live security-test result in this repository. Cross-organisation
read isolation remains an open security issue: some AppSync model reads allow any authenticated
user, so Lambda checks do not protect those direct GraphQL reads. Do not use one shared deployment
for multiple organisations until this is fixed. See `SECURITY_TEST_REPORT.md` for known limitations
and live-test status.

## Setup

```bash
npm ci
npx ampx sandbox secret set SENDER_EMAIL   # a verified SES identity
npx ampx sandbox secret set APP_URL        # http://localhost:5173
npm run deploy:sandbox                     # fails unless "Deployment completed"
npm run dev
```

Amplify Hosting builds with `amplify.yml` (Node 22, `ampx pipeline-deploy`, then `npm run build`).
Per branch, set the secrets `SENDER_EMAIL` and `APP_URL` (`https://<branch>.<appId>.amplifyapp.com`)
in the Amplify console. The first administrator is created in Cognito (group ADMIN); they create
their own team profile on the **My profile** page, then add everyone else from **Team**.

| Setting | Where | Default |
|---|---|---|
| `SENDER_EMAIL`, `APP_URL` | Amplify secrets (SSM Parameter Store) | — (required) |
| `ASSISTANT_MODEL_ID` | environment at deploy time (Amplify console env var for branches) | `eu.anthropic.claude-haiku-4-5-20251001-v1:0` |
| `/teamtask/<deployment>/assistant/modelId` | SSM parameter written by the stack (for reference) | the model in use |

## AI assistant

A floating 3D orb on every page opens the **TeamTask Assistant** for every role. Permissions are
enforced by code, never by the model:

- identity (user id, email, role) comes only from the Cognito token validated by API Gateway; the
  organisation is looked up on the server; nothing in the message or the request body can change it;
- every tool checks the role and the organisation and returns only the fields the role needs;
  anything not allowed — or not existing — returns the same `FORBIDDEN`, and the assistant answers
  "You don't have access to this information with your role.";
- the assistant never writes: changes come back as **action cards**; **Confirm** calls the normal
  task API with the user's own session, so all API rules apply again;
- the guardrail filters prompt attacks (HIGH), off-topic requests and emails/phone numbers in
  answers; content of tasks and documents is treated as data;
- 30 messages per user per hour, 2,000 characters per message; activity (tool, role,
  allowed/denied, duration) is logged without message text.

| Tool | VIEWER | MEMBER | PROJECT_MANAGER | ADMIN |
|---|---|---|---|---|
| getMyTasks | — | ✓ | ✓ | ✓ |
| getProjectStatus | aggregates | ✓ | ✓ | ✓ |
| getProjectTasks | — | projects where they have a task; limited fields | ✓ full | ✓ full |
| getTaskDetails | — | own task (full) or task of their project (limited) | ✓ | ✓ |
| getWeeklyReports | summaries | ✓ | ✓ | ✓ |
| getTeamWorkload | — | — | ✓ | ✓ |
| getRisksAndDelays | — | own tasks | ✓ | ✓ |
| getEscalations | — | — | ✓ | ✓ |
| getAuditEvents | — | — | — | ✓ |
| getAgentActivity | — | — | — | ✓ |
| Action cards | none | change my task status, report a blocker | + assign, change due date, start planning | same as PM |

The matrix lives in `amplify/functions/shared/assistantAccess.ts` (shown in the panel under
"See my access") and is unit-tested tool × role in `amplify/functions/assistant-tools/tools.test.ts`.
To switch the model (for example to an Amazon Nova profile if Anthropic models aren't enabled in the
account), deploy with `ASSISTANT_MODEL_ID=eu.amazon.nova-lite-v1:0`; no code change.

## Email verification

Accounts are created by administrators (no self sign-up) and start with an unverified email. After
signing in, users enter the 6-digit code Cognito emails them (resend after 60 s). Until then the app
and the APIs refuse the account. Uses Cognito's own codes (expiry, single use, rate limits).

## Career suggestions and agent activity

- **Career suggestions** (My profile, inside the CV): generated by Bedrock from the user's own profile,
  read on the server (`POST /profile/career-suggestions`, 20/hour). Labelled AI, not job openings.
- **Agent activity**: "View agent activity" under each answer shows what the assistant did live (tools,
  outcome, duration). The **Agent activity** page lists recorded executions (`GET /assistant/executions`):
  your own, or the whole organisation's for an ADMIN. Questions, answers and tool data are never stored.

## Proposal features

| Feature | How it works |
|---|---|
| AI planning (project > **AI plan**, managers) | The scope goes to the approval state machine (Step Functions): Bedrock proposes tasks, subtasks, owners (skills, capacity, planned absence), priorities, estimates, due dates and dependencies; code checks every owner, date and link. The manager edits, then approves or rejects. Tasks are created only after approval, with the normal task rules. No decision within `PLAN_DECISION_DAYS` (default 7) = expired. |
| Approvals | `AIRecommendation` and `Approval` are read-only for users; only `requestProjectPlan` / `decideRecommendation` and the workflow change them. |
| AI weekly report | Numbers and risks are computed by code; Bedrock writes the summary and corrective actions (checked: it must quote the real completion rate), otherwise the rule-based text is kept. Labelled AI. |
| Attachments | Task drawer; S3 `task-attachments/<taskId>/`, 10 MB, PDF/images/Office/text/CSV/JSON/ZIP. Managers and members upload, managers delete. |
| Teams, planned absence | Team page (teams, lead, filter); absence in My profile; absent members are not suggested as owners. |
| REST task API | `POST /tasks`, `GET/PATCH /tasks/{id}`, `POST /tasks/{id}/status`, `/assign`, `/close`, `GET /projects/{id}/tasks` (Cognito ID token; optional `Idempotency-Key` UUID). Forwarded to the task functions with the caller's token: same rules as the app. |
| Scheduled checks | EventBridge Scheduler (daily 07:00 UTC, Fridays 15:00 UTC), 3 retries, dead-letter queue. |
| Operations | KMS keys (rotation), multi-region CloudTrail with file validation, Object Lock archive of every audit event (governance, 365 days), CloudWatch alarms to an SNS topic, dashboard `TeamTask-<branch>`. |
| Pilot metrics (managers) | Assignment quality, reminder effectiveness, overdue trend, estimated time saved (from the manager's own assumptions). |

| Setting | Where |
|---|---|
| `ALARM_EMAIL` | Amplify console environment variable: email subscribed to the alarm topic (confirm the email AWS sends). |
| `PLAN_DECISION_DAYS` | Amplify console environment variable (default 7). |
| `/teamtask/<branch>/notifications/chat-webhook` | Optional SecureString SSM parameter with a Teams or Slack incoming-webhook URL. |

## Tests

| Command | What |
|---|---|
| `npm test` | Unit tests (rules, Eisenhower, career suggestions, assistant permission matrix, chat parsing) |
| `npm run lint` | oxlint |
| `SEC_TEST_PASSWORD=… npm run security:setup` then `npm run test:security` | Live security suite against the sandbox (see `SECURITY_TEST_REPORT.md`) |
| `npm run security:report` | Markdown tables from the last security run |

Manual assistant checks: `docs/ASSISTANT_MANUAL_TEST.md`.

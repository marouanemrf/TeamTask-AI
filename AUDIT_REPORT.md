# TeamTask AI — Audit report

Project: TeamTask AI (Gogo Security) · React 19 + TypeScript + Vite 8 · AWS Amplify Gen 2 (eu-north-1)
Audit date: 2026-10-16 · Scope: verification only (no features, no refactor).

### Fixes made during this audit

| # | Problem (breaks the backend build) | Fix | Files |
|---|---|---|---|
| 1 | `npx ampx sandbox` failed with `Object type extension 'Mutation' cannot redeclare field createTask`. The custom mutations `createTask` and `updateTask` collide with the mutations Amplify generates for the `Task` model, which the Lambdas themselves use. | Renamed the custom mutations to **`addTask`** and **`editTask`**. `changeTaskStatus`, `assignTask` and `cancelTask` don't collide and were left unchanged. | `amplify/data/resource.ts` (definitions and header comment), `amplify/functions/create-task/handler.ts:13`, `amplify/functions/update-task/handler.ts:16`, `src/services/taskService.ts` (`client.mutations.addTask` / `editTask`) |

After this fix, the backend synthesizes and passes the type checks. The deploy then stops on a **second, older blocker** in `amplify/storage/resource.ts` (issue #1 below). It was **not fixed**: the fix changes where profile photos are stored (4–5 files and existing paths), which is a design decision, not a one-line bug fix.

---

## 1. Summary

| Section | ✅ | ⚠️ | ❌ |
|---|---|---|---|
| A. Authentication | 2 | 3 | 0 |
| B. Data model | 4 | 1 | 0 |
| C. App shell & pages | 11 | 1 | 1 |
| D. Business rules (server) | 8 | 2 | 0 |
| E. Automation | 4 | 2 | 0 |
| F. Code organisation | 3 | 0 | 1 |
| G. Security & quality | 3 | 2 | 1 |
| H. Not started (absence confirmed) | 4 | 0 | 0 |
| **Total** | **39** | **11** | **3** |

Headline findings (details in §4):

- **The backend does not deploy.** `npx ampx sandbox --once` failed twice. The first cause (a mutation name collision) is fixed. The second (an overlapping storage path) is open. **The live sandbox is therefore still the pre-Lambda version**: it doesn't enforce the server rules or the Task/TaskEvent lock-down, and the current frontend's task mutations don't exist there.

- **The local checks pass:** build, type-check, lint (0 errors, 8 warnings) and unit tests (47 tests in 3 files).
- **Security:** the `Dependency` model can still be written directly by managers. That bypasses the server-side circular-dependency check.
- **Correctness:**
  - Several Lambda and client queries combine `limit` with `filter`. DynamoDB applies the limit before the filter, so they can silently miss rows. The impact: duplicate weekly reports, a false "member not found" on escalation reassignment, and presence heartbeat failures.
  - Idempotency is check-then-write, not atomic.
- **The demo seeds (C13) are missing.** `seedTeam.ts` and `seedProject.ts` and their buttons no longer exist.
- **The UI language is mixed.** Most of the UI is in English: in an earlier session the product owner explicitly asked for English everywhere. Escalations, Reports and part of Profile are in French, and so are the server error messages. G4 is marked ❌ against this checklist's "all French" requirement. See the note in G4.

---

## 2. Checklist

Legend: ✅ done · ⚠️ partial · ❌ missing. Line numbers refer to the files as they were during the audit.

### A. Authentication

| # | Status | Evidence | Note |
|---|---|---|---|
| A1 | ⚠️ | `amplify/auth/resource.ts:9-11` (`loginWith: { email: true }`) | Email login is in place. `fullname` is **not declared** in `defineAuth`. The standard `name` attribute is still written by `manage-team-member/handler.ts:52` (`{ Name: 'name', … }`). |
| A2 | ✅ | `amplify/auth/resource.ts:14` | Groups `ADMIN`, `PROJECT_MANAGER`, `MEMBER` and `VIEWER`. |
| A3 | ✅ | `amplify/backend.ts:43-46` | `allowAdminCreateUserOnly: true`. |
| A4 | ⚠️ | `src/main.tsx:12` (`<Authenticator.Provider>` only) | The Amplify `<Authenticator>` UI is **replaced** by a custom login (`src/App.tsx:58-63`). There is no `I18n.setLanguage("fr")` and no Amplify header/footer. Sign-up isn't offered anywhere in the UI. This was an intentional design change. |
| A5 | ⚠️ | `src/components/layout/LoginLayout.tsx`, `LoginScene3D.tsx`; `src/components/ui/LoginForm.tsx:205` | A branded 3D login exists. The helper text reads **"No account? Contact your administrator."** (English) instead of "Pas de compte ? Contactez votre administrateur." |

### B. Data model (`amplify/data/resource.ts`)

| # | Status | Evidence | Note |
|---|---|---|---|
| B1 | ✅ | Lines 35, 47, 77, 102, 115, 141, 159, 172, 187, 199, 214 and 238 | All 12 models exist. An extra `Presence` model (378-379) is out of scope. |
| B2 | ✅ | 38-39 (Org→Member/Project), 91-94 (Project→Task/Milestone/Recommendation/Report), 119-121 (Task self relation), 132-133 (dependsOn/blocks), 130-131 (assignee) | All relations are present. |
| B3 | ⚠️ | 41-44, 68-70, 96-99, 109-112, 138, 149-152, 169, 181, 197, 207, 235, 253 | Managers have full rights on Project, Milestone and Dependency. Organisation is full for ADMIN. `TeamMember`, `Reminder` and `Escalation` are read-only for users; their writes go through Lambdas. `WeeklyReport` is readable by any signed-in user, so VIEWER can read it. MEMBER limits are enforced in the Lambdas. **Gap:** `Dependency` is still writable directly by managers (issue #2). |
| B4 | ✅ | 137-138 (`Task`: authenticated read only), 235 (`TaskEvent`: read only), 381-395 (schema-level `allow.resource`) | `grep "models.(Task\|TaskEvent).(create\|update\|delete)" src/` returns no matches. |
| B5 | ✅ | 231-234 | `requestId: a.string()` plus `.secondaryIndexes(index => [index('requestId')])`. |

### C. App shell and pages (`src/`)

| # | Status | Evidence | Note |
|---|---|---|---|
| C1 | ✅ | `src/utils/routes.ts:3-15`; `src/App.tsx:38-49` | Every listed route exists, plus `/profile`. Unknown routes redirect to `/` (App.tsx:49). |
| C2 | ⚠️ | `src/components/layout/AppLayout.tsx:21-28` and `82` (manager-only links filtered); `100` (Sign out in the sidebar footer); `106-120` (top bar) | The sidebar works and manager-only links are hidden. **The top bar has no role badge and no email:** it shows only the avatar and a profile link. |
| C3 | ✅ | `src/context/UserContext.tsx:43-49`; `src/services/authService.ts:62-69`; `src/utils/roles.ts:16-18` | `cognito:groups` is read from the access token. No group means VIEWER. The organisation id is exposed. |
| C4 | ✅ | `src/services/organisationService.ts:11-26`; `UserContext.tsx:47` | "Gogo Security" is created only when `isAdmin`. |
| C5 | ✅ | `src/pages/DashboardPage.tsx:62-75` (stat cards, with an escalations card for managers at line 69); `~82-101` (upcoming tasks, recent projects) | |
| C6 | ✅ | `src/pages/ProjectsListPage.tsx:25-33`, `51-53`; `src/components/projects/ProjectForm.tsx`; `src/utils/projectValidation.ts` | Search, status filter, progress, and validation (end date must be after start date). |
| C7 | ✅ | `src/pages/TeamPage.tsx`; `src/components/team/MemberFormModal.tsx:118` (unique email); `src/pages/MemberDetailPage.tsx:75-79`, `121-125` (delete blocked) | Member writes now go through `manageTeamMember` (server-side duplicate and open-task checks at `manage-team-member/handler.ts:47,93`). |
| C8 | ✅ | `src/components/tasks/KanbanBoard.tsx:4-6`, `89` (dnd-kit + KeyboardSensor); `TaskFormModal.tsx`; `TaskDetailDrawer.tsx:74`, `191` (history); `src/components/projects/MilestonesPanel.tsx` | |
| C9 | ✅ | `src/pages/MyTasksPage.tsx:208-214` (sections); `src/components/tasks/MyTaskRow.tsx:71`; `amplify/functions/shared/rules.ts:182-190` (10–500 characters) | The button label is **"Report a blocker"** (English). |
| C10 | ✅ | `src/pages/WorkloadPage.tsx:64`, `108-110`; `src/components/team/WorkloadRow.tsx`, `ReassignControl.tsx` | |
| C11 | ✅ | `src/pages/EscalationsPage.tsx:27` (manager guard), `60-63` (resolve form); `src/services/automationService.ts` | |
| C12 | ✅ | `src/pages/ReportsPage.tsx:35` ("Générer maintenant", ADMIN only); `amplify/functions/weekly-report/handler.ts:18` | |
| C13 | ❌ | — | `src/utils/seedTeam.ts`, `src/utils/seedProject.ts` and the "Load demo …" buttons **no longer exist** (`grep -rn "seedTeam\|seedDemoProject" src` returns nothing). |

### D. Business rules (server side)

| # | Status | Evidence | Note |
|---|---|---|---|
| D1 | ⚠️ | `amplify/data/resource.ts:261-366` | Covers `addTask` (create) and `editTask` (update), both renamed during this audit (see Fixes), plus `changeTaskStatus`, `assignTask`, `cancelTask`, `logEvent` and `resolveEscalation`, and also `generateWeeklyReport`, `manageTeamMember`, `updateMyProfile` and `heartbeatPresence`. **They are not deployed yet:** the sandbox deploy is blocked (issue #1). |
| D2 | ✅ | `amplify/functions/shared/auth.ts:44-53`; `shared/handler.ts:24-26` | Groups come from `identity.groups` or the `cognito:groups` claim. The email comes from AdminGetUser, because the access token has no email claim. VIEWER-only callers are rejected. |
| D3 | ✅ | `amplify/functions/change-task-status/handler.ts:24-32`; `shared/rules.ts:172` (`canPerform`) | The assignee's email must match the caller's email. |
| D4 | ✅ | `change-task-status/handler.ts:51-52`; `shared/rules.ts:86-110` | `DEPENDENCY` error, naming the blocking tasks. |
| D5 | ✅ | `update-task/handler.ts:48-53` (cycle and parent checks) | A new task in `create-task` can't form a cycle. **Bypass:** see issue #1. |
| D6 | ✅ | `cancel-task/handler.ts:26` | Sets status CANCELLED. No task delete exists anywhere in `amplify/` or `src/`. |
| D7 | ⚠️ | `shared/audit.ts` (`findEventByRequestId`); used in every task handler (e.g. `change-task-status/handler.ts:34`) | Check-then-write is **not atomic**: two concurrent identical requests can both write. `resolveEscalation` has no `clientRequestId`. |
| D8 | ✅ | `shared/audit.ts` (`writeEvent`: actorType, actorEmail, before, after, requestId); `deadline-check/handler.ts:104` | `resolve-escalation` writes an `APPROVED` event but no ASSIGNED or due-date event for the task change it makes (`resolve-escalation/handler.ts:34,38,44-51`). |
| D9 | ✅ | `shared/errors.ts` (codes); every handler message is in French (e.g. `create-task/handler.ts:15`, `shared/validate.ts:11-77`) | Format: `[CODE] message`. |
| D10 | ✅ | `amplify/functions/shared/rules.ts`; `rules.test.ts:19-147`; `automationRules.test.ts` | The frontend re-uses the same rules (`src/utils/taskRules.ts`). |

### E. Automation

| # | Status | Evidence | Note |
|---|---|---|---|
| E1 | ✅ | `deadline-check/resource.ts:8` (`0 7 * * ? *`, daily at 07:00 UTC), `:13` (2 days); `shared/automationRules.ts:23-34` | Reminders go out before the due date and daily while a task is overdue (deduplicated per day, `deadline-check/handler.ts:34-45`). |
| E2 | ✅ | `automationRules.ts:33`; `deadline-check/handler.ts:89-97` | Escalates when overdue by 2 or more days, or when a HIGH/CRITICAL task is overdue. Only one OPEN escalation per task. |
| E3 | ⚠️ | `weekly-report/resource.ts:8` (`0 15 ? * 6 *`, Friday 15:00 UTC); `shared/weeklyReport.ts:62-71`, `126-139` | Summary, risks and actions are generated. The "one per project per week" check uses `list({ filter, limit: 1 })` (`weeklyReport.ts:63`). The limit is applied **before** the filter, so it can miss an existing report and create a duplicate. |
| E4 | ⚠️ | `amplify/backend.ts:74-80` (SES scoped to one identity ARN); `deadline-check/resource.ts:11-12`, `weekly-report/resource.ts:11-12` | The SES policy is scoped correctly. **`SENDER_EMAIL` is a hard-coded personal address**, not configuration. `APP_URL` falls back to `http://localhost:5173`. The SES sandbox only delivers to verified recipients. |
| E5 | ✅ | `deadline-check/handler.ts:47-65` (Reminder SENT/FAILED), `75-110` (try/catch per task) | |
| E6 | ✅ | `amplify/functions/shared/emailTemplates.ts:13-23` | French HTML (`lang="fr"`), HTML escaping, and a plain-text alternative. Lint: unused `subject` at line 14. |

### F. Code organisation

| # | Status | Evidence | Note |
|---|---|---|---|
| F1 | ✅ | `src/pages/*`, `src/components/{layout,ui,projects,tasks,team}` | `src/context/` holds the two providers. |
| F2 | ❌ | **Violations:** `src/pages/ProfilePage.tsx:34` (`client.mutations.updateMyProfile`, plus `remove()` and `fetchAuthSession()` from Amplify directly); `src/context/PresenceContext.tsx:12` (`client.mutations.heartbeatPresence`) and `:25` (`client.models.Presence`) | All other data access goes through `src/services`. |
| F3 | ✅ | `src/hooks/*`, `src/utils/*`, `src/styles/theme.css` | |
| F4 | ✅ | Components and pages use PascalCase, hooks and services camelCase, functions kebab-case (`amplify/functions/*`) | Cross-boundary import: `manage-team-member/handler.ts:8` imports `../../../src/utils/text` (backend depends on frontend code). |

### G. Security and quality

| # | Status | Evidence | Note |
|---|---|---|---|
| G1 | ⚠️ | Searched for `AKIA…`, `secret`, `password = '…'` and `.env` files: **none found** | No keys or passwords. A **personal email address is hard-coded** in `amplify/backend.ts:74`, `deadline-check/resource.ts:11` and `weekly-report/resource.ts:11`. That is PII in the code, not a secret. |
| G2 | ⚠️ | `.gitignore` covers `amplify_outputs*` and `.amplify`, but has no `.env` entry (only `*.local`) | Also: **the project is not a git repository** (`git rev-parse` fails), so nothing is versioned or backed up. |
| G3 | ✅ | `amplify/functions/shared/validate.ts:10-77`; `manage-team-member/handler.ts:33-38`; `manage-profile/handler.ts:8-12` | Lengths, enums, dates, UUIDs and list sizes are validated. |
| G4 | ❌ | English UI strings (examples): `AppLayout.tsx:22-28,100` ("Dashboard", "Projects", "My tasks", "Team", "Team workload", "Sign out"); `LoginForm.tsx:202,205`; `DashboardPage.tsx:62-75`; `MyTaskRow.tsx:71`; `WorkloadPage.tsx:108-110`; `ProjectDetailPage.tsx:169`; `TeamPage.tsx:92`; `index.html:2` (`lang="en"`). French UI: `EscalationsPage.tsx`, `ReportsPage.tsx`, part of `ProfilePage.tsx`, the escalations card at `DashboardPage.tsx:69`, and all server errors. | **The UI language is mixed.** Note: in an earlier session the product owner explicitly asked for **all UI text in English**. That conflicts with this checklist, so the target language needs a decision. |
| G5 | ✅ | `theme.css:107` (`:focus-visible`), `429`, `496`; form fields wrapped in `<label>` (e.g. `EscalationsPage.tsx:60-63`, `ProfilePage.tsx:42-51`); icon buttons have `aria-label` (`AppLayout.tsx:111`) | |
| G6 | ✅ | No `TODO`/`FIXME`/`console.log` in `src/` or `amplify/` | `console.warn`/`console.error` are used on purpose (CloudWatch and diagnostics). |

### H. Not started (absence confirmed)

| # | Status | Evidence | Note |
|---|---|---|---|
| H1 | ✅ absent | No `bedrock` reference in `amplify/` or `src/` | |
| H2 | ✅ absent | No Step Functions / `sfn` reference | |
| H3 | ✅ absent | `amplify/storage/resource.ts` only defines `avatars/*` | S3 exists for profile pictures only. There is no attachment storage. |
| H4 | ✅ absent | `src/services/authService.ts:16` ("MFA … not enabled") | |

---

## 3. Automatic checks

| Check | Result | Key lines |
|---|---|---|
| `npm install` | ✅ pass | Only `allow-scripts` notices (core-js, esbuild). |
| `npx tsc --noEmit` | ✅ pass | Exit 0. Note: the root tsconfig has `files: []`, so this checks nothing on its own. |
| `npx tsc -b` (app) | ✅ pass | Exit 0. |
| `npx tsc --noEmit -p amplify` | ✅ pass | Exit 0. |
| `npm run build` | ✅ pass | Built in 7.0 s. Warning: chunks over 500 kB (`index` 1,236 kB / 342 kB gzip; `LoginScene3D` 996 kB / 269 kB gzip, lazy-loaded). |
| `npx vitest run` | ✅ pass | 3 files, 47 tests (`rules.test.ts`, `automationRules.test.ts`, `eisenhower.test.ts`). |
| `npm run lint` | ✅ pass (0 errors, 8 warnings) | Unused `subject` (`emailTemplates.ts:14`) and `getCaller` (`resolve-escalation/handler.ts:4`); `set-state-in-effect` in `EscalationsPage.tsx:25`, `ProjectDetailPage.tsx:63`, `ProfilePage.tsx:22`; `exhaustive-deps` in `ProfilePage.tsx:22`; `only-export-components` in `UserContext.tsx:25` and `PresenceContext.tsx:59`. |
| `npx ampx sandbox --once` (run 1) | ❌ fail | `[AmplifyDataConstructInitializationError] … Object type extension 'Mutation' cannot redeclare field createTask`. **Fixed** (see Fixes). Note: the CLI exits 0 even on failure. |
| `npx ampx sandbox --once` (run 2, after the fix) | ❌ fail | The backend synthesized (54 s) and the type checks passed. Then: `[InvalidStorageAccessPathError] A path cannot be a prefix of another path that contains the {entity_id} token.` (`amplify/storage/resource.ts:12` `avatars/*` vs `:17` `avatars/users/{entity_id}/*`). **Not fixed**: see issue #1. |
| Checks re-run after the fix | ✅ pass | `tsc -b`, `tsc -p amplify`, `vitest` (47/47) and `build` all pass. |

Folder tree (depth 3, excluding `node_modules`):

```text
amplify/
  auth/resource.ts
  backend.ts
  data/resource.ts
  functions/
    assign-task/ cancel-task/ change-task-status/ create-task/ update-task/ log-event/
    deadline-check/ weekly-report/ resolve-escalation/
    manage-team-member/ manage-profile/ presence/          (each: handler.ts, resource.ts)
    shared/ audit.ts auth.ts automationRules.ts automationRules.test.ts data.ts
            emailTemplates.ts errors.ts handler.ts rules.ts rules.test.ts validate.ts weeklyReport.ts
  package.json  storage/resource.ts  tsconfig.json
src/
  App.tsx  App.css  index.css  main.tsx  assets/
  components/layout/   AppLayout LoginLayout LoginScene3D
  components/projects/ EisenhowerMatrix MilestonesPanel ProjectEditModal ProjectForm ProjectHeader ProjectsTable RecentProjects
  components/tasks/    BlockReasonNote BlockerModal KanbanBoard MyTaskRow PriorityBadge TaskCard TaskDetailDrawer TaskFormModal TaskList TaskListTable
  components/team/     MemberAvatar MemberCard MemberFormModal PresenceDot ReassignControl RoleBadge SkillChips SkillsInput WorkloadBar WorkloadRow
  components/ui/       Icons LoginForm Modal NewPasswordForm StatCard StatusBadge
  context/             PresenceContext UserContext
  hooks/               useCreateProject useProject useProjects useSignIn useTasks useTeam useUser
  pages/               Dashboard Escalations Login MemberDetail MyTasks Profile ProjectCreate ProjectDetail ProjectsList Reports Team Workload
  services/            amplifyConfig apiError auditService authService automationService client dependencyService milestoneService organisationService projectService taskService teamService
  styles/theme.css
  utils/               apiErrors authErrors cssVar dates eisenhower(.test) image projectLabels projectValidation roles routes taskRules taskStats taskStatus text validation workload
```

`src/App.css`, `src/index.css` and `src/assets/*` are unused Vite template leftovers.

---

## 4. Top 10 issues (security first)

1. **The backend can't be deployed, so the server-side security isn't live.** `amplify/storage/resource.ts:12,17` declares `avatars/*` and `avatars/users/{entity_id}/*`, and Amplify refuses a path that is a prefix of an `{entity_id}` path. Until this is fixed, the deployed sandbox keeps the old schema: Task is writable by managers and MEMBER, TaskEvent is writable by any user, and no Lambda rules apply. The current frontend's `addTask`/`editTask`/`changeTaskStatus` calls also fail against it. *Fix:* move self-service photos to a non-overlapping prefix (e.g. `profile-avatars/{entity_id}/*`), then update the upload path in `src/pages/ProfilePage.tsx` and the avatar-path regex in `manage-profile/handler.ts:11` and `manage-team-member/handler.ts:39`. Then redeploy.
2. **Dependency rules can be bypassed.** `amplify/data/resource.ts:149-152` lets ADMIN and PROJECT_MANAGER write `Dependency` directly. A direct `client.models.Dependency.create` call can therefore create circular or cross-project links that `editTask` would reject. *Fix:* make `Dependency` `allow.authenticated().to(['read'])`, like `Task`, so that only the task functions write it.
3. **Idempotency is not atomic.** `amplify/functions/shared/audit.ts` (`findEventByRequestId` then write) lets two concurrent requests with the same `clientRequestId` both write. *Fix:* write the TaskEvent first with a deterministic id (for example `id = requestId`) using a conditional create, and treat "already exists" as the replay.
4. **Hard-coded personal email as the SES sender and identity** (`amplify/backend.ts:74`, `deadline-check/resource.ts:11`, `weekly-report/resource.ts:11`). *Fix:* read the sender from a sandbox/branch secret or environment variable, and use a verified domain identity.
5. **`resolveEscalation` changes tasks without the task audit trail or idempotency.** `amplify/functions/resolve-escalation/handler.ts:34,38` writes no ASSIGNED or due-date event and takes no `clientRequestId`. *Fix:* write ASSIGNED/UPDATED TaskEvents with before/after, and accept a `clientRequestId`.
6. **The profile avatar path can point at another user's file.** `amplify/functions/manage-profile/handler.ts:11` accepts any `avatars/users/<anyIdentity>/…`. *Fix:* require the caller's own identity id in the path (this pairs with issue #1).
7. **`limit` before `filter` makes reassignment fail.** `amplify/functions/resolve-escalation/handler.ts:31` uses `TeamMember.list({ filter, limit: 2 })`, which can return "member not found" for a valid email. *Fix:* drop the small `limit` and paginate, or query through an index on email.
8. **`limit` before `filter` allows duplicate weekly reports.** `amplify/functions/shared/weeklyReport.ts:63` (`limit: 1`). *Fix:* paginate without a small limit, or use a deterministic id per project, year and week with a conditional create.
9. **`limit` before `filter` breaks the presence heartbeat.** `amplify/functions/presence/handler.ts:191,202` (`limit: 1`) misses the existing row; the create then collides on the fixed id and the retry fails. *Fix:* use `get({ id: 'presence-' + email })` or the `email` secondary index (`listPresenceByEmail`).
10. **Data access outside `src/services`.** `src/pages/ProfilePage.tsx:34` and `src/context/PresenceContext.tsx:12,25` call the Amplify client directly. *Fix:* move these calls into `profileService.ts` and `presenceService.ts`, and use them through hooks.

Also worth doing, outside the top 10:

- Restore the demo seeds (C13) behind ADMIN-only buttons.
- Decide on one UI language (G4) and align all strings and `index.html` `lang`.
- Put the project under git and add `.env*` to `.gitignore`.
- Clear the 8 lint warnings.
- Add a role badge to the top bar (C2).
- Paginate `automationService.listOpenEscalations`, which uses `limit: 1000` and `limit: 200` with filters.
- Remove the backend import of `src/utils/text` (`manage-team-member/handler.ts:8`).
- Make the CI or deploy script check the `ampx` output, since the CLI exits 0 even on failure.

---

## 5. Manual test plan (browser)

### Prerequisite

Issue #1 must be fixed and `npx ampx sandbox --once` must end with **"Deployment completed"**. Until then, the server-side checks below can't pass against the live sandbox.

### Setup

Create the test users in the Cognito console. Pool `eu-north-1_q2eRJssju` → Users → Create user, using your own test email addresses. Then add each user to a group, or create them from **Team → Add member**, which uses `manageTeamMember`:

| User | Group | Also create a TeamMember? |
|---|---|---|
| `admin.test@…` | ADMIN | yes (Team page) |
| `pm.test@…` | PROJECT_MANAGER | yes |
| `member.test@…` | MEMBER | yes |
| `viewer.test@…` | VIEWER | yes |

Sign in once with each user to set a password. Sign out and back in after any group change.

### ADMIN

1. Log in. Expected: the dashboard loads; the "Gogo Security" organisation exists (it is created on the first ADMIN login if missing); the sidebar shows **Team workload** and **Open escalations**.
2. **Projects → New project** with an end date before the start date. Expected: a validation error. Then a valid project. Expected: you are redirected to the project page.
3. On the project, create 3 tasks: A, B, and C, where C depends on A and B. Expected: CREATED events appear in each task's drawer history.
4. Drag C to **In progress**. Expected: rejected with a message naming A and B; the card stays in To do.
5. Edit A so that it depends on C. Expected: the C option is disabled ("would create a circular dependency"). If a crafted request is sent anyway, the server rejects it with `[VALIDATION]`.
6. Cancel task B from the drawer. Expected: status Cancelled; B is still visible in the Task list tab and is never deleted.
7. **Reports** (`/projects/:id/reports`) → **Générer maintenant**. Expected: a report appears. Click again the same week. Expected: no second report. *Known risk: issue #5.*
8. **Team → Add member**. Expected: the Cognito user and the TeamMember are both created. Try to delete a member who has open tasks. Expected: blocked with an explanation.
9. In the browser console (DevTools), run any direct write to `Task`. Expected: `Unauthorized`.

### PROJECT_MANAGER

1. Expected: same sidebar as ADMIN, but **no "Générer maintenant"** on Reports.
2. Create and edit tasks, assign, and cancel. Expected: all allowed.
3. **Team → Add member** with role ADMIN. Expected: `FORBIDDEN` ("Seul un administrateur…").
4. **Open escalations** (once a task is ≥2 days overdue, or the daily `deadline-check` job has run): resolve one with REASSIGN. Expected: the escalation leaves the list and the task's assignee changes. *Known risk: issue #4.*

### MEMBER

1. Expected: no "New project", "New task", "Add member", "Team workload" or "Open escalations".
2. **My tasks:** change the status of your own task. Expected: OK, with an event by your email.
3. On a project's Kanban, try to drag **another member's** task. Expected: the card is not draggable. Through a direct API call (`changeTaskStatus` on that task id with a new UUID), expected: `[FORBIDDEN] Vous ne pouvez modifier que le statut des tâches qui vous sont attribuées.`
4. **Report a blocker** with a reason under 10 characters. Expected: a validation error. With a valid reason, expected: status Blocked, and the reason is shown on the row, the Kanban card and the drawer.
5. Move a task that depends on an unfinished task to Done. Expected: `[DEPENDENCY]` with the blocking task's name.
6. Idempotency: in DevTools, call `changeTaskStatus` twice with the **same** `clientRequestId`. Expected: one STATUS_CHANGED TaskEvent in DynamoDB (`TaskEvent-…` table, `requestId` column).

### VIEWER

1. Expected: everything is read-only. The role badge isn't shown (C2); check the role in DynamoDB/Cognito instead.
2. My tasks status selects are disabled. A direct API call to any task mutation is expected to return `[FORBIDDEN] Votre rôle ne permet pas de modifier les tâches.`
3. **Reports:** reports can be read; there is no generate button.

### Automation (any role, AWS console)

1. In Lambda → `deadline-check` → Test (empty event), with a task assigned to a verified SES recipient and due tomorrow. Expected: one Reminder row with SENT, and one email in French with a text part. For a task overdue by 2 or more days (or HIGH and overdue): one OPEN Escalation, and no duplicate on a second run.
2. In Lambda → `weekly-report` → Test (empty event). Expected: one WeeklyReport per ACTIVE project for the current ISO week, and an email to `managerEmail`.
3. In CloudWatch Logs for the task functions, rejected attempts should appear as `"outcome":"REJECTED"` warnings, with no TaskEvent written.

---

## Phase 1 — code done, deploy pending

The AWS session expired during this phase: `npx ampx sandbox --once` could not run. Code checks pass
(`tsc` app + amplify, unit tests, lint, e2e suites).

- **Language:** one language, English, for UI, API errors and emails (about 130 French strings translated).
- **Top 10 fixes:** Dependency read-only (#2); atomic idempotency with deterministic ids (#3); SES sender and app URL as Amplify secrets, no email in code (#4); `resolveEscalation` idempotent and audited, paginated member lookup (#5, #7); one weekly report per project and ISO week by id (#8). #1, #6, #9, #10 were fixed earlier.
- **Other:** backend no longer imports from `src/`; paginated escalation lists; `.env*` git-ignored; contexts split for fast refresh; `npm run deploy:sandbox` fails unless "Deployment completed"; `npm run seed:demo` adds Nadia (Risk Analyst) and assigns "Incident response review".
- **Remaining:** deploy and `seed:demo` (need `aws login`); 2 lint warnings (`set-state-in-effect`) to be removed with the data-layer rewrite.

## Role-aware assistant (all users)

| Part | What | Files |
|---|---|---|
| Permission matrix | Single source shared by tools and UI | `amplify/functions/shared/assistantAccess.ts` |
| Tools | 11 tools, organisation-scoped, data minimised, cards only, FORBIDDEN without existence leak | `amplify/functions/assistant-tools/` (`tools.ts`, `dynamoSource.ts`, `handler.ts`, tests) |
| Chat | Identity from the Cognito authorizer, organisation looked up on the server, 30/h rate limit, 2,000 chars, streamed NDJSON, cards only from tool outputs, activity logged without text | `amplify/functions/assistant-chat/` |
| Infrastructure | Bedrock Converse API with tool use (the Bedrock Agent was dropped: Agents classic is in maintenance mode and refuses new agents in this account), guardrail (prompt attack HIGH, off-topic, PII in answers), API Gateway REST (Cognito authorizer, streaming, throttling 20/50, access logs, body validation), assistant table (TTL, PITR), least-privilege IAM | `amplify/custom/assistant/resource.ts`, `amplify/backend.ts` |
| UI | 3D orb launcher (lazy three.js, CSS fallback, reduced motion, paused when hidden, DPR ≤ 1.5); modal panel with role badge, access summary, "See my access", context chip, suggested questions per role, streaming, reasoning steps, action cards (Confirm runs the normal API with the user's session), new conversation, focus trap; opens from the task drawer too | `src/components/agent/*`, `src/hooks/useAssistant*.ts`, `src/services/assistantService.ts` |
| Tests | 67 matrix/isolation/card unit tests, 8 chat unit tests, 26 e2e checks (mocked stream), live security tests `tests/security/m-assistant.test.ts` | |

**Deviations from the request:** the stack has no API Gateway data API, single table, planner agent or Step Functions yet, so the assistant reads the existing per-model tables and its cards confirm through the existing task mutations; the organisation comes from a server-side lookup (Cognito has no org claim); the model id is a deploy-time setting (an SSM lookup at deploy fails under Amplify's deploy role) and the stack writes it to SSM for reference; UI text is English.

**Remaining:** deploy (needs `aws login` and Bedrock model access for the chosen model); live security run; table scans in tools (fine for a pilot).

## Feature updates (verification, profile, projects, team, agent activity, dashboard)

| Area | What | Files |
|---|---|---|
| Email verification | Accounts created by an administrator start unverified. After sign-in a gate asks for the 6-digit code Cognito emails (sent once automatically; resend after 60 s; Cognito generates, expires (24 h) and single-uses codes and rate-limits sends). Clear messages for wrong, expired, rate-limited and undeliverable codes; nothing in URLs. The task functions (`getCaller`) and the assistant/career/activity APIs refuse unverified accounts. | `src/components/auth/EmailVerificationGate.tsx`, `src/hooks/useEmailVerification.ts`, `src/services/authService.ts`, `src/utils/authErrors.ts`, `amplify/functions/shared/auth.ts`, `assistant-chat` |
| My profile | Removed "Use my profile title" and "Tailor CV to this path". Career suggestions are generated by AI (Bedrock Converse, assistant guardrail) from the caller's own profile read on the server; "skills you have" is filtered by code to skills really in the profile; loading / incomplete / unavailable / error states; refreshed when the profile is saved; static catalogue removed. | `amplify/functions/career-suggestions/`, `src/hooks/useCareerSuggestions.ts`, `src/components/team/CareerSuggestions.tsx`, `CvBuilder.tsx`, `ProfilePage.tsx` |
| Projects | Importance/urgency overrides removed from project creation; kept in project settings (existing data and the Eisenhower matrix still use them). | `ProjectForm.tsx` |
| Add member | Root cause: the form inherited the dialog's `max-height` and was 2 px taller than the dialog's content box, so the dialog scrolled too (and its scrollbar caused a horizontal one). The open dialog is now a flex column; only the body scrolls, and only when the content is taller than the screen. Applies to every modal. | `theme.css` |
| Agent activity | Each answer has an execution id and observable steps (tool, status OK / refused / rejected / error, duration, content-free summary) streamed live to "View agent activity" in the panel and recorded (no message text, no tool data). New `GET /assistant/executions`: own executions, whole organisation for ADMIN. New page "Agent activity". | `assistant-chat/chatCore.ts`, `assistant-chat/handler.ts`, `amplify/functions/assistant-activity/`, `src/components/agent/ExecutionDetails.tsx`, `src/pages/AgentActivityPage.tsx` |
| Dashboard / workload | Open escalations = OPEN escalation records whose task is still open (an escalation left OPEN on a done/cancelled task no longer counts); same rule on the escalations page. Workload: open, blocked, unassigned, overdue, overloaded (> capacity), average load, and how many open tasks have no estimate (they count 0 h). | `src/utils/escalations.ts`, `src/utils/workload.ts`, `DashboardPage.tsx`, `WorkloadPage.tsx`, `automationService.ts` |

Validation: `tsc` (app, backend, security tests), 137 unit tests, lint (2 older warnings), build, e2e: updates 38, assistant 28, features 84, app 41, project 51, mytasks 41.
Not deployed yet (AWS session expired): verification enforcement, career suggestions and agent activity need `npm run deploy:sandbox` and Bedrock model access.

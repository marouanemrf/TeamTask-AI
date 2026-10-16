# TeamTask Assistant — manual test script

Run after `npm run deploy:sandbox` (or a branch deploy) and `npm run security:setup`, signed in as
each test user in turn (`sec-a-viewer@…`, `sec-a-member@…`, `sec-a-pm@…`, `sec-a-admin@…`).
Open **Projects → Security test project A**, then the orb (bottom-right). Ask the same five questions
with each role and paste the answer. Click **New conversation** between roles.

| # | Question | VIEWER — expected | MEMBER — expected | PM — expected | ADMIN — expected |
|---|---|---|---|---|---|
| 1 | How is the project going? | Progress %, counts, dates; no task titles | Same + overdue task titles | Same as MEMBER | Same as MEMBER |
| 2 | What are my tasks this week? | Refusal ("You don't have access…") | Own tasks with due dates | PM's own tasks (often none) | Admin's own tasks |
| 3 | Who is overloaded? | Refusal | Refusal | Members with load % | Same as PM |
| 4 | Show the latest actions in the audit trail. | Refusal | Refusal | Refusal | Recent events (task, event, who, when) |
| 5 | Report a blocker on my task: waiting for read-only access. | Refusal, no card | Card "Report a blocker on …" (Confirm/Cancel) | Card if a task is assigned to the PM, else says none | Same as PM |

Also check for every role: "See my access" shows the row above; the context chip shows the project;
**Confirm** on a card changes the task (Kanban updates), **Cancel** changes nothing; nothing is ever
changed without a click.

## Answers (fill in)

| # | VIEWER | MEMBER | PM | ADMIN |
|---|---|---|---|---|
| 1 | | | | |
| 2 | | | | |
| 3 | | | | |
| 4 | | | | |
| 5 | | | | |

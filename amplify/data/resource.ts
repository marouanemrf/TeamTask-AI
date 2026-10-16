import { type ClientSchema, a, defineData } from '@aws-amplify/backend';
import { assignTaskFunction } from '../functions/assign-task/resource';
import { cancelTaskFunction } from '../functions/cancel-task/resource';
import { changeTaskStatusFunction } from '../functions/change-task-status/resource';
import { createTaskFunction } from '../functions/create-task/resource';
import { deadlineCheckFunction } from '../functions/deadline-check/resource';
import { logEventFunction } from '../functions/log-event/resource';
import { resolveEscalationFunction } from '../functions/resolve-escalation/resource';
import { updateTaskFunction } from '../functions/update-task/resource';
import { weeklyReportFunction } from '../functions/weekly-report/resource';
import { manageTeamMemberFunction } from '../functions/manage-team-member/resource';
import { manageProfileFunction } from '../functions/manage-profile/resource';
import { presenceFunction } from '../functions/presence/resource';

/**
 * TeamTask AI data model.
 *
 * Authorization vocabulary:
 * - "managers"      = Cognito groups ADMIN + PROJECT_MANAGER (full access).
 *                     Written inline as literals: a shared string[] variable would
 *                     widen the generated client types.
 * - "authenticated" = any signed-in user
 * - Task and TaskEvent are read-only for users: every write goes through the Lambda mutations
 *   below (addTask, editTask, changeTaskStatus, assignTask, cancelTask, logEvent), which
 *   enforce the business rules server-side and write the audit log.
 *
 * @see https://docs.amplify.aws/react/build-a-backend/data/
 */
const schema = a.schema({
  /* ---------------------------------------------------------------------- */
  /* Organisation & people                                                   */
  /* ---------------------------------------------------------------------- */

  // Top-level tenant (e.g. "Gogo Security").
  Organisation: a
    .model({
      name: a.string().required(),
      members: a.hasMany('TeamMember', 'organisationId'),
      projects: a.hasMany('Project', 'organisationId'),
    })
    .authorization((allow) => [
      allow.group('ADMIN'),
      allow.authenticated().to(['read']),
    ]),

  // A consultant or employee who can be assigned tasks.
  TeamMember: a
    .model({
      organisationId: a.id().required(),
      organisation: a.belongsTo('Organisation', 'organisationId'),
      name: a.string().required(),
      email: a.email().required(),
      // Handle shown as @username; unique per organisation (checked by the app).
      username: a.string(),
      // S3 path of the profile picture in the storage bucket (avatars/...).
      avatarKey: a.string(),
      role: a.enum(['ADMIN', 'PROJECT_MANAGER', 'MEMBER', 'VIEWER']),
      roles: a.string().array(),
      jobTitle: a.string(),
      phoneNumber: a.string(),
      experience: a.string(),
      education: a.string(),
      professionalSummary: a.string(),
      skills: a.string().array(),
      weeklyCapacityHours: a.integer().default(40),
      assignedTasks: a.hasMany('Task', 'assigneeId'),
    })
    .authorization((allow) => [
      allow.authenticated().to(['read']),
    ]),

  /* ---------------------------------------------------------------------- */
  /* Projects & planning                                                     */
  /* ---------------------------------------------------------------------- */

  // A client engagement.
  Project: a
    .model({
      organisationId: a.id().required(),
      organisation: a.belongsTo('Organisation', 'organisationId'),
      name: a.string().required(),
      clientName: a.string(),
      objective: a.string(),
      status: a.enum(['DRAFT', 'ACTIVE', 'ON_HOLD', 'CLOSED']),
      startDate: a.date(),
      endDate: a.date(),
      managerEmail: a.email(),
      businessImpact: a.enum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']),
      importanceOverride: a.integer(),
      urgencyOverride: a.integer(),
      tasks: a.hasMany('Task', 'projectId'),
      milestones: a.hasMany('Milestone', 'projectId'),
      recommendations: a.hasMany('AIRecommendation', 'projectId'),
      weeklyReports: a.hasMany('WeeklyReport', 'projectId'),
    })
    .authorization((allow) => [
      allow.groups(['ADMIN', 'PROJECT_MANAGER']),
      allow.authenticated().to(['read']),
    ]),

  // A dated checkpoint within a project.
  Milestone: a
    .model({
      projectId: a.id().required(),
      project: a.belongsTo('Project', 'projectId'),
      name: a.string().required(),
      dueDate: a.date(),
    })
    .authorization((allow) => [
      allow.groups(['ADMIN', 'PROJECT_MANAGER']),
      allow.authenticated().to(['read']),
    ]),

  // A unit of work. Can have subtasks (self relation) and dependencies.
  Task: a
    .model({
      projectId: a.id().required(),
      project: a.belongsTo('Project', 'projectId'),
      parentTaskId: a.id(),
      parentTask: a.belongsTo('Task', 'parentTaskId'),
      subtasks: a.hasMany('Task', 'parentTaskId'),
      title: a.string().required(),
      description: a.string(),
      status: a.enum(['PROPOSED', 'TODO', 'IN_PROGRESS', 'BLOCKED', 'DONE', 'CANCELLED']),
      priority: a.enum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']),
      dueDate: a.date(),
      estimatedHours: a.float(),
      requiredSkills: a.string().array(),
      createdBy: a.enum(['HUMAN', 'AI']),
      assigneeId: a.id(),
      assignee: a.belongsTo('TeamMember', 'assigneeId'),
      dependsOn: a.hasMany('Dependency', 'fromTaskId'),
      blocks: a.hasMany('Dependency', 'toTaskId'),
      reminders: a.hasMany('Reminder', 'taskId'),
      escalations: a.hasMany('Escalation', 'taskId'),
    })
    // Writes only through the task functions (schema-level allow.resource).
    .authorization((allow) => [allow.authenticated().to(['read'])]),

  // Edge between two tasks: fromTask depends on toTask.
  Dependency: a
    .model({
      fromTaskId: a.id().required(),
      fromTask: a.belongsTo('Task', 'fromTaskId'),
      toTaskId: a.id().required(),
      toTask: a.belongsTo('Task', 'toTaskId'),
      type: a.enum(['FINISH_TO_START']),
    })
    .authorization((allow) => [
      // Read-only for clients: links are written only by the task functions, which check
      // the same-project and no-cycle rules (a direct write could bypass them).
      allow.authenticated().to(['read']),
    ]),

  /* ---------------------------------------------------------------------- */
  /* AI recommendations & human approval                                     */
  /* ---------------------------------------------------------------------- */

  // A suggestion produced by the AI, pending human review.
  AIRecommendation: a
    .model({
      projectId: a.id().required(),
      project: a.belongsTo('Project', 'projectId'),
      type: a.enum(['TASK_PLAN', 'ASSIGNMENT', 'DEADLINE', 'REALLOCATION', 'RISK']),
      payload: a.json(),
      rationale: a.string(),
      status: a.enum(['PENDING', 'APPROVED', 'REJECTED']),
      approval: a.hasOne('Approval', 'recommendationId'),
    })
    .authorization((allow) => [allow.groups(['ADMIN', 'PROJECT_MANAGER'])]),

  // The human decision on a recommendation.
  Approval: a
    .model({
      recommendationId: a.id().required(),
      recommendation: a.belongsTo('AIRecommendation', 'recommendationId'),
      approverEmail: a.email(),
      decision: a.enum(['APPROVED', 'REJECTED']),
      comment: a.string(),
      decidedAt: a.datetime(),
    })
    .authorization((allow) => [allow.groups(['ADMIN', 'PROJECT_MANAGER'])]),

  /* ---------------------------------------------------------------------- */
  /* Follow-up: reminders & escalations                                      */
  /* ---------------------------------------------------------------------- */

  Reminder: a
    .model({
      taskId: a.id().required(),
      task: a.belongsTo('Task', 'taskId'),
      recipientEmail: a.email().required(),
      channel: a.enum(['EMAIL', 'SLACK', 'TEAMS']),
      scheduledAt: a.datetime(),
      sentAt: a.datetime(),
      status: a.enum(['SCHEDULED', 'SENT', 'FAILED']),
    })
    .authorization((allow) => [allow.groups(['ADMIN', 'PROJECT_MANAGER']).to(['read'])]),

  Escalation: a
    .model({
      taskId: a.id().required(),
      task: a.belongsTo('Task', 'taskId'),
      reason: a.string().required(),
      level: a.integer(),
      status: a.enum(['OPEN', 'APPROVED', 'RESOLVED']),
    })
    .authorization((allow) => [allow.groups(['ADMIN', 'PROJECT_MANAGER']).to(['read'])]),

  /* ---------------------------------------------------------------------- */
  /* Audit & reporting                                                       */
  /* ---------------------------------------------------------------------- */

  // Append-only audit log. Users read it; only the functions write it (no update/delete for anyone).
  TaskEvent: a
    .model({
      entityId: a.id().required(),
      eventType: a.enum([
        'CREATED',
        'UPDATED',
        'ASSIGNED',
        'STATUS_CHANGED',
        'APPROVED',
        'REJECTED',
        'REMINDER_SENT',
        'ESCALATED',
      ]),
      actorType: a.enum(['USER', 'AI', 'SYSTEM']),
      actorEmail: a.email(),
      before: a.json(),
      after: a.json(),
      // clientRequestId of the mutation that wrote it: idempotency key.
      requestId: a.string(),
    })
    .secondaryIndexes((index) => [index('requestId')])
    .authorization((allow) => [allow.authenticated().to(['read'])]),

  // Weekly project status snapshot.
  WeeklyReport: a
    .model({
      projectId: a.id().required(),
      project: a.belongsTo('Project', 'projectId'),
      weekNumber: a.integer().required(),
      year: a.integer(),
      totalCount: a.integer(),
      completedCount: a.integer(),
      inProgressCount: a.integer(),
      overdueCount: a.integer(),
      completionRate: a.float(),
      summary: a.string(),
      risks: a.string().array(),
      correctiveActions: a.string().array(),
    })
    .authorization((allow) => [allow.authenticated().to(['read'])]),

  /* ---------------------------------------------------------------------- */
  /* Task API (Lambda): rules, idempotency (clientRequestId) and audit        */
  /* Roles are checked inside each function; enum-like arguments are strings */
  /* validated server-side.                                                  */
  /* ---------------------------------------------------------------------- */

  // Named addTask/editTask: the Task model already generates createTask/updateTask mutations
  // (used by the functions themselves), and AppSync can't declare the same field twice.
  addTask: a
    .mutation()
    .arguments({
      clientRequestId: a.string().required(),
      projectId: a.id().required(),
      title: a.string().required(),
      description: a.string(),
      priority: a.string(),
      status: a.string(),
      dueDate: a.date(),
      estimatedHours: a.float(),
      requiredSkills: a.string().array(),
      assigneeId: a.id(),
      parentTaskId: a.id(),
      dependsOn: a.id().array(),
    })
    .returns(a.ref('Task'))
    .handler(a.handler.function(createTaskFunction))
    .authorization((allow) => [allow.authenticated()]),

  editTask: a
    .mutation()
    .arguments({
      clientRequestId: a.string().required(),
      taskId: a.id().required(),
      title: a.string().required(),
      description: a.string(),
      priority: a.string(),
      dueDate: a.date(),
      estimatedHours: a.float(),
      requiredSkills: a.string().array(),
      assigneeId: a.id(),
      parentTaskId: a.id(),
      // Full set of tasks this one depends on; omit to keep the current links.
      dependsOn: a.id().array(),
    })
    .returns(a.ref('Task'))
    .handler(a.handler.function(updateTaskFunction))
    .authorization((allow) => [allow.authenticated()]),

  changeTaskStatus: a
    .mutation()
    .arguments({
      clientRequestId: a.string().required(),
      taskId: a.id().required(),
      status: a.string().required(),
      // Required (10–500 characters) when status is BLOCKED.
      reason: a.string(),
    })
    .returns(a.ref('Task'))
    .handler(a.handler.function(changeTaskStatusFunction))
    .authorization((allow) => [allow.authenticated()]),

  assignTask: a
    .mutation()
    .arguments({
      clientRequestId: a.string().required(),
      taskId: a.id().required(),
      // null/omitted = unassign
      assigneeId: a.id(),
    })
    .returns(a.ref('Task'))
    .handler(a.handler.function(assignTaskFunction))
    .authorization((allow) => [allow.authenticated()]),

  cancelTask: a
    .mutation()
    .arguments({
      clientRequestId: a.string().required(),
      taskId: a.id().required(),
      reason: a.string(),
    })
    .returns(a.ref('Task'))
    .handler(a.handler.function(cancelTaskFunction))
    .authorization((allow) => [allow.authenticated()]),

  // Audit events for non-task records (projects, members, milestones); refused for tasks.
  logEvent: a
    .mutation()
    .arguments({
      clientRequestId: a.string(),
      entityId: a.id().required(),
      eventType: a.string().required(),
      actorType: a.string(),
      before: a.json(),
      after: a.json(),
    })
    .returns(a.ref('TaskEvent'))
    .handler(a.handler.function(logEventFunction))
    .authorization((allow) => [allow.authenticated()]),

  resolveEscalation: a
    .mutation()
    .arguments({
      clientRequestId: a.string().required(),
      escalationId: a.id().required(),
      decision: a.string().required(),
      comment: a.string(),
      newAssigneeEmail: a.email(),
      newDueDate: a.date(),
    })
    .returns(a.ref('Escalation'))
    .handler(a.handler.function(resolveEscalationFunction))
    .authorization((allow) => [allow.authenticated()]),

  generateWeeklyReport: a
    .mutation()
    .arguments({ projectId: a.id().required() })
    .returns(a.ref('WeeklyReport'))
    .handler(a.handler.function(weeklyReportFunction))
    .authorization((allow) => [allow.authenticated()]),

  manageTeamMember: a.mutation().arguments({
    action: a.string().required(), memberId: a.id(), organisationId: a.id(), name: a.string(), email: a.email(), username: a.string(), roles: a.string().array(), role: a.string(), jobTitle: a.string(), skills: a.string().array(), weeklyCapacityHours: a.integer(), avatarKey: a.string(),
  }).returns(a.ref('TeamMember')).handler(a.handler.function(manageTeamMemberFunction)).authorization((allow) => [allow.authenticated()]),
  updateMyProfile: a.mutation().arguments({ name: a.string(), phoneNumber: a.string(), jobTitle: a.string(), skills: a.string().array(), experience: a.string(), education: a.string(), professionalSummary: a.string(), avatarKey: a.string() }).returns(a.ref('TeamMember')).handler(a.handler.function(manageProfileFunction)).authorization((allow) => [allow.authenticated()]),
  heartbeatPresence: a.mutation().arguments({ status: a.string().required() }).returns(a.ref('Presence')).handler(a.handler.function(presenceFunction)).authorization((allow) => [allow.authenticated()]),

  Presence: a.model({ email: a.email().required(), status: a.enum(['ONLINE', 'BUSY']), lastSeenAt: a.datetime().required() })
    .secondaryIndexes((index) => [index('email')]).authorization((allow) => [allow.authenticated().to(['read'])]),
})
  // The functions read and write every model with their own IAM identity.
  .authorization((allow) => [
    allow.resource(createTaskFunction),
    allow.resource(updateTaskFunction),
    allow.resource(changeTaskStatusFunction),
    allow.resource(assignTaskFunction),
    allow.resource(cancelTaskFunction),
    allow.resource(logEventFunction),
    allow.resource(deadlineCheckFunction),
    allow.resource(weeklyReportFunction),
    allow.resource(resolveEscalationFunction),
    allow.resource(manageTeamMemberFunction),
    allow.resource(manageProfileFunction),
    allow.resource(presenceFunction),
  ]);

export type Schema = ClientSchema<typeof schema>;

// All requests are authorized with the Cognito user pool token (groups are read from it).
export const data = defineData({
  schema,
  authorizationModes: {
    defaultAuthorizationMode: 'userPool',
  },
});

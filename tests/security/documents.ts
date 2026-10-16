/** GraphQL operations used by the security tests (minimal selections: only what the checks read). */

export const Q = {
  listProjects: `query { listProjects(limit: 1000) { items { id organisationId name } } }`,
  getProject: `query ($id: ID!) { getProject(id: $id) { id organisationId name } }`,
  listTasks: `query { listTasks(limit: 1000) { items { id projectId title assigneeId } } }`,
  getTask: `query ($id: ID!) { getTask(id: $id) { id projectId title status assigneeId dueDate } }`,
  listTeamMembers: `query { listTeamMembers(limit: 1000) { items { id organisationId email } } }`,
  getTeamMember: `query ($id: ID!) { getTeamMember(id: $id) { id organisationId email phoneNumber } }`,
  listTaskEventsByRequest: `query ($r: String!) { listTaskEventByRequestId(requestId: $r) { items { id entityId eventType } } }`,
  listTaskEvents: `query { listTaskEvents(limit: 5) { items { id } } }`,
};

export const M = {
  createProject: `mutation ($input: CreateProjectInput!) { createProject(input: $input) { id organisationId } }`,
  updateProject: `mutation ($input: UpdateProjectInput!) { updateProject(input: $input) { id name } }`,
  deleteProject: `mutation ($input: DeleteProjectInput!) { deleteProject(input: $input) { id } }`,
  createMilestone: `mutation ($input: CreateMilestoneInput!) { createMilestone(input: $input) { id } }`,
  createDependency: `mutation ($input: CreateDependencyInput!) { createDependency(input: $input) { id } }`,
  createOrganisation: `mutation ($input: CreateOrganisationInput!) { createOrganisation(input: $input) { id } }`,
  createTaskEvent: `mutation ($input: CreateTaskEventInput!) { createTaskEvent(input: $input) { id } }`,
  updateTaskEvent: `mutation ($input: UpdateTaskEventInput!) { updateTaskEvent(input: $input) { id } }`,
  deleteTaskEvent: `mutation ($input: DeleteTaskEventInput!) { deleteTaskEvent(input: $input) { id } }`,
  createTask: `mutation ($input: CreateTaskInput!) { createTask(input: $input) { id } }`,
  updateTask: `mutation ($input: UpdateTaskInput!) { updateTask(input: $input) { id } }`,
  createApproval: `mutation ($input: CreateApprovalInput!) { createApproval(input: $input) { id } }`,
  updateAIRecommendation: `mutation ($input: UpdateAIRecommendationInput!) { updateAIRecommendation(input: $input) { id status } }`,
  createAIRecommendation: `mutation ($input: CreateAIRecommendationInput!) { createAIRecommendation(input: $input) { id status } }`,
  updateTeamMember: `mutation ($input: UpdateTeamMemberInput!) { updateTeamMember(input: $input) { id } }`,
  addTask: `mutation ($clientRequestId: String!, $projectId: ID!, $title: String!, $priority: String, $dueDate: AWSDate, $assigneeId: ID, $dependsOn: [ID]) {
    addTask(clientRequestId: $clientRequestId, projectId: $projectId, title: $title, priority: $priority, dueDate: $dueDate, assigneeId: $assigneeId, dependsOn: $dependsOn) { id projectId assigneeId title } }`,
  editTask: `mutation ($clientRequestId: String!, $taskId: ID!, $title: String!, $assigneeId: ID, $dependsOn: [ID], $dueDate: AWSDate) {
    editTask(clientRequestId: $clientRequestId, taskId: $taskId, title: $title, assigneeId: $assigneeId, dependsOn: $dependsOn, dueDate: $dueDate) { id title } }`,
  changeTaskStatus: `mutation ($clientRequestId: String!, $taskId: ID!, $status: String!, $reason: String) {
    changeTaskStatus(clientRequestId: $clientRequestId, taskId: $taskId, status: $status, reason: $reason) { id status } }`,
  assignTask: `mutation ($clientRequestId: String!, $taskId: ID!, $assigneeId: ID) { assignTask(clientRequestId: $clientRequestId, taskId: $taskId, assigneeId: $assigneeId) { id assigneeId } }`,
  cancelTask: `mutation ($clientRequestId: String!, $taskId: ID!) { cancelTask(clientRequestId: $clientRequestId, taskId: $taskId) { id status } }`,
  logEvent: `mutation ($clientRequestId: String, $entityId: ID!, $eventType: String!) { logEvent(clientRequestId: $clientRequestId, entityId: $entityId, eventType: $eventType) { id } }`,
  resolveEscalation: `mutation ($clientRequestId: String!, $escalationId: ID!, $decision: String!) { resolveEscalation(clientRequestId: $clientRequestId, escalationId: $escalationId, decision: $decision) { id } }`,
  generateWeeklyReport: `mutation ($projectId: ID!) { generateWeeklyReport(projectId: $projectId) { id } }`,
  manageTeamMember: `mutation ($action: String!, $memberId: ID, $organisationId: ID, $name: String, $email: AWSEmail, $username: String, $roles: [String], $weeklyCapacityHours: Int) {
    manageTeamMember(action: $action, memberId: $memberId, organisationId: $organisationId, name: $name, email: $email, username: $username, roles: $roles, weeklyCapacityHours: $weeklyCapacityHours) { id } }`,
  updateMyProfile: `mutation ($name: String) { updateMyProfile(name: $name) { id } }`,
  heartbeatPresence: `mutation ($status: String!) { heartbeatPresence(status: $status) { id } }`,
};

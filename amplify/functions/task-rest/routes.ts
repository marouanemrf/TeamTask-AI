/**
 * REST task API on API Gateway — pure routing: which GraphQL operation a REST call becomes.
 * The handler sends it to the data API (AppSync) with the caller's own Cognito token, so every
 * rule of the task functions applies unchanged (roles, organisation, validation, audit,
 * idempotency). Nothing here grants anything.
 */

const TASK_FIELDS = "id projectId parentTaskId title description status priority dueDate estimatedHours requiredSkills createdBy assigneeId createdAt updatedAt";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ID = /^[A-Za-z0-9:_-]{1,128}$/;

export interface GraphqlCall {
  query: string;
  variables: Record<string, unknown>;
  /** Field of the GraphQL result to return. */
  field: string;
  /** HTTP status on success. */
  status: number;
}

export type Route = { ok: true; call: GraphqlCall } | { ok: false; status: number; message: string };

const pick = (body: Record<string, unknown>, keys: string[]) => Object.fromEntries(keys.filter((k) => body[k] !== undefined).map((k) => [k, body[k]]));

/**
 * Maps a REST request to a GraphQL call. `requestId` = Idempotency-Key header (UUID) when given,
 * otherwise a fresh one: retrying with the same key applies the change once.
 */
export function route(method: string, resource: string, params: Record<string, string | undefined>, body: Record<string, unknown>, idempotencyKey: string | undefined, newId: () => string): Route {
  if (idempotencyKey !== undefined && !UUID.test(idempotencyKey)) return { ok: false, status: 400, message: "Idempotency-Key must be a UUID." };
  const clientRequestId = idempotencyKey ?? newId();
  const taskId = params.taskId;
  const projectId = params.projectId;
  if ((taskId !== undefined && !ID.test(taskId)) || (projectId !== undefined && !ID.test(projectId))) return { ok: false, status: 400, message: "Invalid id." };

  switch (`${method} ${resource}`) {
    case "GET /projects/{projectId}/tasks":
      return { ok: true, call: { field: "listTasks", status: 200, query: `query($projectId: ID!) { listTasks(filter: { projectId: { eq: $projectId } }, limit: 1000) { items { ${TASK_FIELDS} } } }`, variables: { projectId } } };
    case "GET /tasks/{taskId}":
      return { ok: true, call: { field: "getTask", status: 200, query: `query($id: ID!) { getTask(id: $id) { ${TASK_FIELDS} } }`, variables: { id: taskId } } };
    case "POST /tasks":
      return { ok: true, call: { field: "addTask", status: 201, query: `mutation($clientRequestId: String!, $projectId: ID!, $title: String!, $description: String, $priority: String, $status: String, $dueDate: AWSDate, $estimatedHours: Float, $requiredSkills: [String], $assigneeId: ID, $parentTaskId: ID, $dependsOn: [ID]) { addTask(clientRequestId: $clientRequestId, projectId: $projectId, title: $title, description: $description, priority: $priority, status: $status, dueDate: $dueDate, estimatedHours: $estimatedHours, requiredSkills: $requiredSkills, assigneeId: $assigneeId, parentTaskId: $parentTaskId, dependsOn: $dependsOn) { ${TASK_FIELDS} } }`, variables: { clientRequestId, ...pick(body, ["projectId", "title", "description", "priority", "status", "dueDate", "estimatedHours", "requiredSkills", "assigneeId", "parentTaskId", "dependsOn"]) } } };
    case "PATCH /tasks/{taskId}":
      return { ok: true, call: { field: "editTask", status: 200, query: `mutation($clientRequestId: String!, $taskId: ID!, $title: String!, $description: String, $priority: String, $dueDate: AWSDate, $estimatedHours: Float, $requiredSkills: [String], $assigneeId: ID, $parentTaskId: ID, $dependsOn: [ID]) { editTask(clientRequestId: $clientRequestId, taskId: $taskId, title: $title, description: $description, priority: $priority, dueDate: $dueDate, estimatedHours: $estimatedHours, requiredSkills: $requiredSkills, assigneeId: $assigneeId, parentTaskId: $parentTaskId, dependsOn: $dependsOn) { ${TASK_FIELDS} } }`, variables: { clientRequestId, taskId, ...pick(body, ["title", "description", "priority", "dueDate", "estimatedHours", "requiredSkills", "assigneeId", "parentTaskId", "dependsOn"]) } } };
    case "POST /tasks/{taskId}/status":
      return { ok: true, call: { field: "changeTaskStatus", status: 200, query: `mutation($clientRequestId: String!, $taskId: ID!, $status: String!, $reason: String) { changeTaskStatus(clientRequestId: $clientRequestId, taskId: $taskId, status: $status, reason: $reason) { ${TASK_FIELDS} } }`, variables: { clientRequestId, taskId, ...pick(body, ["status", "reason"]) } } };
    case "POST /tasks/{taskId}/assign":
      return { ok: true, call: { field: "assignTask", status: 200, query: `mutation($clientRequestId: String!, $taskId: ID!, $assigneeId: ID) { assignTask(clientRequestId: $clientRequestId, taskId: $taskId, assigneeId: $assigneeId) { ${TASK_FIELDS} } }`, variables: { clientRequestId, taskId, ...pick(body, ["assigneeId"]) } } };
    case "POST /tasks/{taskId}/close":
      return { ok: true, call: { field: "cancelTask", status: 200, query: `mutation($clientRequestId: String!, $taskId: ID!, $reason: String) { cancelTask(clientRequestId: $clientRequestId, taskId: $taskId, reason: $reason) { ${TASK_FIELDS} } }`, variables: { clientRequestId, taskId, ...pick(body, ["reason"]) } } };
    default:
      return { ok: false, status: 404, message: "Unknown route." };
  }
}

/** HTTP status for a task API error message "[CODE] message". */
export function statusForError(message: string): number {
  const code = /^\[([A-Z_]+)\]/.exec(message)?.[1];
  if (code === "FORBIDDEN") return 403;
  if (code === "NOT_FOUND") return 404;
  if (code === "VALIDATION" || code === "DEPENDENCY") return 400;
  if (/Unauthorized|Not Authorized/i.test(message)) return 403;
  return 502;
}

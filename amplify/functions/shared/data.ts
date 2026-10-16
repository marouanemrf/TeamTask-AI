import { Amplify } from "aws-amplify";
import { generateClient } from "aws-amplify/data";
import { getAmplifyDataClientConfig } from "@aws-amplify/backend/function/runtime";
import type { Schema } from "../../data/resource";
import { fail } from "./errors";
import { canBeAssigned } from "./rules";

export type DataClient = ReturnType<typeof generateClient<Schema>>;
export type TaskRecord = Schema["Task"]["type"];
export type DependencyRecord = Schema["Dependency"]["type"];

type FunctionEnv = Parameters<typeof getAmplifyDataClientConfig>[0];

/** Data client authorised as the function itself (IAM, via allow.resource on the schema). */
export async function createDataClient(env: FunctionEnv): Promise<DataClient> {
  const { resourceConfig, libraryOptions } = await getAmplifyDataClientConfig(env);
  Amplify.configure(resourceConfig, libraryOptions);
  return generateClient<Schema>();
}

function check<T>(result: { data: T; errors?: readonly { message: string }[] }, what: string): T {
  if (result.errors?.length) throw new Error(`${what}: ${result.errors.map((e) => e.message).join("; ")}`);
  return result.data;
}

/* -------------------------------------------------------------------------- */
/* Reads                                                                       */
/* -------------------------------------------------------------------------- */

export async function getTask(client: DataClient, taskId: string): Promise<TaskRecord> {
  const task = check(await client.models.Task.get({ id: taskId }), "Task.get");
  if (!task) fail("NOT_FOUND", "This task no longer exists.");
  return task;
}

export async function getProject(client: DataClient, projectId: string) {
  const project = check(await client.models.Project.get({ id: projectId }), "Project.get");
  if (!project) fail("NOT_FOUND", "This project no longer exists.");
  return project;
}

/** A member of the organisation, or NOT_FOUND. */
export async function getMember(client: DataClient, memberId: string, organisationId: string) {
  const member = check(await client.models.TeamMember.get({ id: memberId }), "TeamMember.get");
  if (!member || member.organisationId !== organisationId) fail("NOT_FOUND", "This member isn't part of the organisation.");
  return member;
}

/**
 * The organisation member with this email (case-insensitive), or null. Paginates the whole
 * organisation: a small `limit` with a filter would be applied before the filter and miss rows.
 */
export async function findMemberByEmail(client: DataClient, organisationId: string, email: string) {
  const wanted = email.trim().toLowerCase();
  let nextToken: string | null | undefined;
  do {
    const page = await client.models.TeamMember.list({ filter: { organisationId: { eq: organisationId } }, nextToken, limit: 1000 });
    const found = check(page, "TeamMember.list").find((m) => m.email.toLowerCase() === wanted);
    if (found) return found;
    nextToken = page.nextToken;
  } while (nextToken);
  return null;
}

/** The member a task is given to: in the project's organisation and allowed to hold tasks. */
export async function getAssignee(client: DataClient, memberId: string, organisationId: string) {
  const member = await getMember(client, memberId, organisationId);
  if (!canBeAssigned(member)) fail("VALIDATION", "This member has read-only access and can't be assigned tasks.");
  return member;
}

export async function listProjectTasks(client: DataClient, projectId: string): Promise<TaskRecord[]> {
  const tasks: TaskRecord[] = [];
  let nextToken: string | null | undefined;
  do {
    const page = await client.models.Task.list({ filter: { projectId: { eq: projectId } }, nextToken, limit: 1000 });
    tasks.push(...check(page, "Task.list"));
    nextToken = page.nextToken;
  } while (nextToken);
  return tasks;
}

/** Dependencies touching the given tasks (Dependency has no projectId, so filter by task ids). */
export async function listDependencies(client: DataClient, taskIds: ReadonlySet<string>): Promise<DependencyRecord[]> {
  const deps: DependencyRecord[] = [];
  let nextToken: string | null | undefined;
  do {
    const page = await client.models.Dependency.list({ nextToken, limit: 1000 });
    deps.push(...check(page, "Dependency.list").filter((d) => taskIds.has(d.fromTaskId) || taskIds.has(d.toTaskId)));
    nextToken = page.nextToken;
  } while (nextToken);
  return deps;
}

/* -------------------------------------------------------------------------- */
/* Writes                                                                      */
/* -------------------------------------------------------------------------- */

/** Makes `taskId` depend exactly on `dependsOn` (adds missing links, removes the others). */
export async function setDependencies(
  client: DataClient,
  taskId: string,
  dependsOn: readonly string[],
  current: readonly DependencyRecord[],
): Promise<void> {
  const existing = current.filter((d) => d.fromTaskId === taskId);
  const wanted = new Set(dependsOn);
  for (const dep of existing.filter((d) => !wanted.has(d.toTaskId))) {
    check(await client.models.Dependency.delete({ id: dep.id }), "Dependency.delete");
  }
  const have = new Set(existing.map((d) => d.toTaskId));
  for (const toTaskId of dependsOn.filter((id) => !have.has(id))) {
    check(await client.models.Dependency.create({ fromTaskId: taskId, toTaskId, type: "FINISH_TO_START" }), "Dependency.create");
  }
}

export { check };

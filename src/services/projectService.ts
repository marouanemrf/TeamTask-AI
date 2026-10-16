import { ApiError } from "./apiError";
import { logEvent } from "./auditService";
import { client } from "./client";
import type { Project, ProjectStatus } from "./client";
import type { AuditActor } from "./teamService";

export interface NewProjectInput {
  organisationId: string;
  name: string;
  clientName?: string;
  objective?: string;
  startDate?: string; // YYYY-MM-DD
  endDate?: string; // YYYY-MM-DD
  status: ProjectStatus;
  managerEmail?: string;
  businessImpact?: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  importanceOverride?: number;
  urgencyOverride?: number;
}

/** Live project list (AppSync subscriptions). Returns an unsubscribe function. */
export function observeProjects(onChange: (projects: Project[]) => void, onError: (err: unknown) => void): () => void {
  const subscription = client.models.Project.observeQuery().subscribe({
    next: ({ items }) => onChange([...items]),
    error: onError,
  });
  return () => subscription.unsubscribe();
}

export async function getProject(id: string): Promise<Project | null> {
  const { data, errors } = await client.models.Project.get({ id });
  if (errors?.length) throw ApiError.from(errors, "Project load failed");
  return data;
}

/** Creates a project, then records a CREATED event in the audit log. Throws ApiError if refused. */
export async function createProject(input: NewProjectInput, actor: AuditActor): Promise<Project> {
  const { data, errors } = await client.models.Project.create({
    organisationId: input.organisationId,
    name: input.name,
    clientName: input.clientName || undefined,
    objective: input.objective || undefined,
    startDate: input.startDate || undefined,
    endDate: input.endDate || undefined,
    status: input.status,
    managerEmail: input.managerEmail || undefined,
    businessImpact: input.businessImpact,
    importanceOverride: input.importanceOverride,
    urgencyOverride: input.urgencyOverride,
  });
  if (!data || errors?.length) throw ApiError.from(errors, "Project creation failed");

  await logEvent({ entityId: data.id, eventType: "CREATED", actorType: actor.type === "SYSTEM" ? "SYSTEM" : "USER", after: data });
  return data;
}

/** Fields a manager can edit after creation. */
export interface ProjectChanges {
  status: ProjectStatus;
  startDate?: string;
  endDate?: string;
  objective?: string;
  businessImpact?: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  importanceOverride?: number;
  urgencyOverride?: number;
}

/** Updates status / dates / objective and logs STATUS_CHANGED with before/after. */
export async function updateProject(before: Project, changes: ProjectChanges, actor: AuditActor): Promise<Project> {
  for (const value of [changes.importanceOverride, changes.urgencyOverride]) if (value !== undefined && (!Number.isInteger(value) || value < 1 || value > 5)) throw new ApiError("Priority overrides must be whole numbers from 1 to 5", "VALIDATION");
  const { data, errors } = await client.models.Project.update({
    id: before.id,
    status: changes.status,
    startDate: changes.startDate || null,
    endDate: changes.endDate || null,
    objective: changes.objective || null,
    businessImpact: changes.businessImpact === undefined ? before.businessImpact : changes.businessImpact,
    importanceOverride: changes.importanceOverride === undefined ? before.importanceOverride : changes.importanceOverride,
    urgencyOverride: changes.urgencyOverride === undefined ? before.urgencyOverride : changes.urgencyOverride,
  });
  if (!data || errors?.length) throw ApiError.from(errors, "Project update failed");

  const pick = (p: Project) => ({ status: p.status, startDate: p.startDate, endDate: p.endDate, objective: p.objective, businessImpact: p.businessImpact, importanceOverride: p.importanceOverride, urgencyOverride: p.urgencyOverride });
  await logEvent({
    entityId: data.id,
    eventType: "STATUS_CHANGED",
    actorType: actor.type === "SYSTEM" ? "SYSTEM" : "USER",
    before: pick(before),
    after: pick(data),
  });
  return data;
}

/** First project of the organisation with exactly this name, or null. */
export async function findProjectByName(organisationId: string, name: string): Promise<Project | null> {
  let nextToken: string | null | undefined;
  do {
    const { data, errors, nextToken: token } = await client.models.Project.list({
      filter: { organisationId: { eq: organisationId }, name: { eq: name } },
      nextToken,
    });
    if (errors?.length) throw ApiError.from(errors, "Project lookup failed");
    if (data.length > 0) return data[0];
    nextToken = token;
  } while (nextToken);
  return null;
}

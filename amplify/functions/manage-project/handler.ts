import { randomUUID } from "node:crypto";
import { env } from "$amplify/env/manage-project";
import type { Schema } from "../../data/resource";
import { writeEvent } from "../shared/audit";
import { check, createDataClient, getProject } from "../shared/data";
import { fail } from "../shared/errors";
import { runMutation } from "../shared/handler";
import { isManagerRole } from "../shared/rules";
import { requireOrganisation } from "../shared/tenancy";
import * as v from "../shared/validate";

const client = await createDataClient(env);

type ProjectRecord = Schema["Project"]["type"];
type SaveArgs = Schema["saveProject"]["args"];
type MilestoneArgs = Schema["addMilestone"]["args"];

const STATUSES = ["DRAFT", "ACTIVE", "ON_HOLD", "CLOSED"] as const;
const IMPACTS = ["LOW", "MEDIUM", "HIGH", "CRITICAL"] as const;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

function oneOf<T extends string>(value: unknown, allowed: readonly T[], field: string): T {
  if (!(allowed as readonly unknown[]).includes(value)) fail("VALIDATION", `${field} must be one of: ${allowed.join(", ")}.`);
  return value as T;
}

/** 1 to 5, or null to clear; undefined = unchanged. */
function override(value: unknown, field: string): number | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (!Number.isInteger(value) || (value as number) < 1 || (value as number) > 5) fail("VALIDATION", `${field} must be a whole number from 1 to 5.`);
  return value as number;
}

function dates(startDate: string | null, endDate: string | null) {
  if (startDate && endDate && endDate < startDate) fail("VALIDATION", "The end date must be on or after the start date.");
}

const auditFields = (p: ProjectRecord) => ({
  status: p.status, startDate: p.startDate, endDate: p.endDate, objective: p.objective,
  businessImpact: p.businessImpact, importanceOverride: p.importanceOverride, urgencyOverride: p.urgencyOverride,
});

async function createProject(organisationId: string, email: string, args: SaveArgs) {
  const managerEmail = args.managerEmail?.trim().toLowerCase() || null;
  if (managerEmail && !EMAIL.test(managerEmail)) fail("VALIDATION", "The manager email address is invalid.");
  const startDate = v.optionalDate(args.startDate, "Start date");
  const endDate = v.optionalDate(args.endDate, "End date");
  dates(startDate, endDate);
  const created = check(await client.models.Project.create({
    organisationId,
    name: v.text(args.name, "Name", { max: 200 }),
    clientName: v.optionalText(args.clientName, "Client", 200),
    objective: v.optionalText(args.objective, "Objective", 5000),
    status: oneOf(args.status ?? "DRAFT", STATUSES, "Status"),
    startDate,
    endDate,
    managerEmail,
    businessImpact: args.businessImpact ? oneOf(args.businessImpact, IMPACTS, "Business impact") : null,
    importanceOverride: override(args.importanceOverride, "Importance") ?? null,
    urgencyOverride: override(args.urgencyOverride, "Urgency") ?? null,
  }), "Project.create");
  if (!created) throw new Error("Project.create returned no data");
  await writeEvent(client, { organisationId, entityId: created.id, eventType: "CREATED", actorEmail: email, after: { name: created.name, clientName: created.clientName, ...auditFields(created) }, requestId: randomUUID() });
  return created;
}

/** Fields a manager can change after creation: status, dates, objective and priority inputs. */
async function updateProject(organisationId: string, email: string, projectId: string, args: SaveArgs) {
  const before = await getProject(client, projectId, organisationId);
  const startDate = args.startDate === undefined ? before.startDate ?? null : v.optionalDate(args.startDate, "Start date");
  const endDate = args.endDate === undefined ? before.endDate ?? null : v.optionalDate(args.endDate, "End date");
  dates(startDate, endDate);
  const importance = override(args.importanceOverride, "Importance");
  const urgency = override(args.urgencyOverride, "Urgency");
  const updated = check(await client.models.Project.update({
    id: before.id,
    status: args.status === undefined ? before.status : oneOf(args.status, STATUSES, "Status"),
    startDate,
    endDate,
    objective: args.objective === undefined ? before.objective ?? null : v.optionalText(args.objective, "Objective", 5000),
    businessImpact: args.businessImpact === undefined ? before.businessImpact : args.businessImpact ? oneOf(args.businessImpact, IMPACTS, "Business impact") : null,
    importanceOverride: importance === undefined ? before.importanceOverride : importance,
    urgencyOverride: urgency === undefined ? before.urgencyOverride : urgency,
  }), "Project.update");
  if (!updated) fail("NOT_FOUND", "This project no longer exists.");
  await writeEvent(client, { organisationId, entityId: updated.id, eventType: "STATUS_CHANGED", actorEmail: email, before: auditFields(before), after: auditFields(updated), requestId: randomUUID() });
  return updated;
}

async function addMilestone(organisationId: string, email: string, args: MilestoneArgs) {
  const project = await getProject(client, v.id(args.projectId, "Project"), organisationId);
  const created = check(await client.models.Milestone.create({
    organisationId,
    projectId: project.id,
    name: v.text(args.name, "Name", { max: 200 }),
    dueDate: v.optionalDate(args.dueDate, "Due date"),
  }), "Milestone.create");
  if (!created) throw new Error("Milestone.create returned no data");
  await writeEvent(client, { organisationId, entityId: created.id, eventType: "CREATED", actorEmail: email, after: { projectId: created.projectId, name: created.name, dueDate: created.dueDate }, requestId: randomUUID() });
  return created;
}

// Amplify passes the GraphQL field name at the top level of the event (fieldName, typeName).
export const handler = (event: { arguments: SaveArgs | MilestoneArgs; identity?: unknown; fieldName?: string; info?: { fieldName?: string } }) =>
  runMutation("manage-project", event, async (caller, args) => {
    if (!isManagerRole(caller.roles)) fail("FORBIDDEN", "Only administrators and project managers can manage projects.");
    const organisationId = requireOrganisation(caller);
    if ((event.fieldName ?? event.info?.fieldName) === "addMilestone") return addMilestone(organisationId, caller.email, args as MilestoneArgs);
    const save = args as SaveArgs;
    return save.projectId ? updateProject(organisationId, caller.email, save.projectId, save) : createProject(organisationId, caller.email, save);
  }) as ReturnType<Schema["saveProject"]["functionHandler"]>;

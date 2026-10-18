import { env } from "$amplify/env/create-task";
import type { Schema } from "../../data/resource";
import { createDataClient } from "../shared/data";
import { fail } from "../shared/errors";
import { runMutation } from "../shared/handler";
import { requireOrganisation } from "../shared/tenancy";
import { canPerform } from "../shared/rules";
import { createTaskRecord } from "../shared/taskCreate";

const client = await createDataClient(env);

/** Creates a task (managers), its dependencies, and a CREATED audit event. Idempotent on clientRequestId. */
export const handler: Schema["addTask"]["functionHandler"] = (event) =>
  runMutation("create-task", event, async (caller, args) => {
    const organisationId = requireOrganisation(caller);
    if (!canPerform("create", caller.roles)) fail("FORBIDDEN", "Only administrators and project managers can create tasks.");
    return createTaskRecord(client, { email: caller.email, organisationId }, args, "HUMAN");
  });

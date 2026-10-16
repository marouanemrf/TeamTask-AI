import { logEvent } from "./auditService";
import { client } from "./client";
import type { Organisation } from "./client";

export const DEFAULT_ORGANISATION_NAME = "Gogo Security";

/**
 * Returns the first organisation. If none exists and `canCreate` is true (ADMIN),
 * creates the default one; otherwise returns null.
 */
export async function getOrCreateDefaultOrganisation(
  canCreate: boolean,
): Promise<Organisation | null> {
  const { data: organisations } = await client.models.Organisation.list();
  if (organisations.length > 0) return organisations[0];
  if (!canCreate) return null;

  const { data: created, errors } = await client.models.Organisation.create({ name: DEFAULT_ORGANISATION_NAME });
  if (!created || errors?.length) {
    console.warn("[organisationService] Creation refused", errors);
    return null;
  }

  await logEvent({ entityId: created.id, eventType: "CREATED", after: created });
  return created;
}

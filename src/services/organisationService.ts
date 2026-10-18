import { fetchAuthSession } from "aws-amplify/auth";
import { client } from "./client";
import type { Organisation } from "./client";

export const DEFAULT_ORGANISATION_NAME = "Gogo Security";

/** The organisation the signed-in user may read (the data API only returns their own). */
async function ownOrganisation(): Promise<Organisation | null> {
  const { data } = await client.models.Organisation.list();
  return data[0] ?? null;
}

/**
 * Returns the user's organisation. Access comes from the organisation groups of the session, so
 * when none is visible the tokens are refreshed once (groups granted after sign-in). If there is
 * still none and `canCreate` is true (ADMIN), the server sets up a new organisation with this
 * administrator in it (it refuses if the account already belongs to one); otherwise null.
 */
export async function getOrCreateDefaultOrganisation(canCreate: boolean): Promise<Organisation | null> {
  const current = await ownOrganisation();
  if (current) return current;

  await fetchAuthSession({ forceRefresh: true });
  const refreshed = await ownOrganisation();
  if (refreshed || !canCreate) return refreshed;

  const { errors } = await client.mutations.manageTeamMember({ action: "SETUP_ORGANISATION", name: DEFAULT_ORGANISATION_NAME });
  if (errors?.length) {
    console.warn("[organisationService] Organisation setup refused", errors);
    return null;
  }
  // The new organisation groups are in the next tokens.
  await fetchAuthSession({ forceRefresh: true });
  return ownOrganisation();
}

import { client } from "./client";

export type OwnPresence = "ONLINE" | "BUSY";

export interface PresenceRow {
  email: string;
  status: string | null;
  lastSeenAt: string;
}

/** Records that the signed-in user is active (server: presence function). Failures are only logged. */
export async function sendHeartbeat(status: OwnPresence): Promise<void> {
  try {
    const { errors } = await client.mutations.heartbeatPresence({ status });
    if (errors?.length) console.warn("[presenceService] Heartbeat rejected", errors);
  } catch (err) {
    console.warn("[presenceService] Heartbeat failed", err);
  }
}

/** Live list of everyone's last heartbeat. Returns an unsubscribe function. */
export function observePresence(onChange: (rows: PresenceRow[]) => void, onError: (err: unknown) => void): () => void {
  const subscription = client.models.Presence.observeQuery().subscribe({
    next: ({ items }) => onChange(items.map(({ email, status, lastSeenAt }) => ({ email, status: status ?? null, lastSeenAt }))),
    error: onError,
  });
  return () => subscription.unsubscribe();
}

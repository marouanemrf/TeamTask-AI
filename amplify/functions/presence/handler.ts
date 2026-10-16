import { env } from '$amplify/env/presence';
import type { Schema } from '../../data/resource';
import { check, createDataClient } from '../shared/data';
import { fail } from '../shared/errors';
import { getCaller } from '../shared/auth';
import { TaskApiError, toClientMessage } from '../shared/errors';
const db = await createDataClient(env);
export const handler: Schema['heartbeatPresence']['functionHandler'] = async (event) => {
  try {
    const caller = await getCaller(event.identity);
    const args = event.arguments;
    if (args.status !== 'ONLINE' && args.status !== 'BUSY') fail('VALIDATION', 'Unknown presence status.');
    const timestamp = new Date().toISOString();
    // One row per user with a deterministic id: a direct get (a filtered list with a small
    // limit can miss the row, since DynamoDB applies the limit before the filter).
    const id = `presence-${caller.email}`;
    const found = check(await db.models.Presence.get({ id }), 'Presence.get');
    let result;
    if (found) result = await db.models.Presence.update({ id, status: args.status, lastSeenAt: timestamp });
    else {
      result = await db.models.Presence.create({ id, email: caller.email, status: args.status, lastSeenAt: timestamp });
      // Two first heartbeats racing: the create fails on the existing id, so update instead.
      if (result.errors?.length) result = await db.models.Presence.update({ id, status: args.status, lastSeenAt: timestamp });
    }
    const row = check(result, 'Presence.write');
    if (!row) fail('NOT_FOUND', "Your presence couldn't be recorded.");
    return row;
  } catch (error) {
    if (error instanceof TaskApiError) throw new Error(toClientMessage(error.code, error.message));
    console.error('[presence] heartbeat failed', error); throw new Error('Une erreur est survenue sur le serveur.');
  }
};

import { env } from '$amplify/env/resolve-escalation';
import type { Schema } from '../../data/resource';
import { findEventByRequestId, snapshot, writeEvent } from '../shared/audit';
import { createDataClient, check, findMemberByEmail, getAssignee, getProject, getTask } from '../shared/data';
import { fail } from '../shared/errors';
import { runMutation } from '../shared/handler';
import { isManagerRole } from '../shared/rules';
import { assertSameOrganisation, requireOrganisation } from '../shared/tenancy';
import * as v from '../shared/validate';

const client = await createDataClient(env);
type Decision = 'REASSIGN' | 'EXTEND_DEADLINE' | 'ACCEPT_DELAY';
const DECISIONS: readonly Decision[] = ['REASSIGN', 'EXTEND_DEADLINE', 'ACCEPT_DELAY'];

/**
 * A manager resolves an open escalation. Idempotent on clientRequestId; every task change is
 * audited like the task API does (ASSIGNED / UPDATED with before and after), plus an APPROVED
 * event that records the decision.
 */
export const handler: Schema['resolveEscalation']['functionHandler'] = (event) =>
  runMutation('resolve-escalation', event, async (caller, args) => {
    if (!isManagerRole(caller.roles)) fail('FORBIDDEN', "Only administrators and project managers can resolve an escalation.");
    const organisationId = requireOrganisation(caller);
    const requestId = v.requestId(args.clientRequestId);
    const escalationId = v.id(args.escalationId, 'Escalation');
    const previous = await findEventByRequestId(client, requestId);
    if (previous) {
      const done = check(await client.models.Escalation.get({ id: escalationId }), 'Escalation.get');
      if (done) { assertSameOrganisation(done, organisationId, 'This escalation'); return done; }
    }

    const decision = args.decision as Decision;
    if (!DECISIONS.includes(decision)) fail('VALIDATION', 'The decision must be REASSIGN, EXTEND_DEADLINE or ACCEPT_DELAY.');
    const comment = v.optionalText(args.comment, 'Comment', 1000);
    const escalation = check(await client.models.Escalation.get({ id: escalationId }), 'Escalation.get');
    if (!escalation) fail('NOT_FOUND', 'This escalation no longer exists.');
    assertSameOrganisation(escalation, organisationId, 'This escalation');
    if (escalation.status !== 'OPEN') fail('VALIDATION', 'This escalation has already been handled.');
    const task = await getTask(client, escalation.taskId, organisationId);
    const project = await getProject(client, task.projectId, organisationId);
    const before = snapshot(task);

    if (decision === 'REASSIGN') {
      if (!args.newAssigneeEmail) fail('VALIDATION', "The new assignee's email address is required.");
      const member = await findMemberByEmail(client, project.organisationId, args.newAssigneeEmail);
      if (!member) fail('NOT_FOUND', 'No member of this organisation has this email address.');
      await getAssignee(client, member.id, project.organisationId);
      const updated = check(await client.models.Task.update({ id: task.id, assigneeId: member.id }), 'Task.update');
      if (!updated) throw new Error('Task.update returned no data');
      await writeEvent(client, {
        organisationId,
        entityId: task.id,
        eventType: 'ASSIGNED',
        actorEmail: caller.email,
        before: { assigneeId: before.assigneeId ?? null },
        after: { assigneeId: member.id, escalationId },
        requestId,
      });
    } else if (decision === 'EXTEND_DEADLINE') {
      const dueDate = v.optionalDate(args.newDueDate, 'New due date');
      if (!dueDate) fail('VALIDATION', 'The new due date is required.');
      const updated = check(await client.models.Task.update({ id: task.id, dueDate }), 'Task.update');
      if (!updated) throw new Error('Task.update returned no data');
      await writeEvent(client, {
        organisationId,
        entityId: task.id,
        eventType: 'UPDATED',
        actorEmail: caller.email,
        before: { dueDate: before.dueDate ?? null },
        after: { dueDate, escalationId },
        requestId,
      });
    }

    const resolved = check(await client.models.Escalation.update({ id: escalation.id, status: 'RESOLVED' }), 'Escalation.update');
    if (!resolved) throw new Error('Escalation.update returned no data');
    await writeEvent(client, {
      organisationId,
      entityId: task.id,
      eventType: 'APPROVED',
      actorEmail: caller.email,
      before: { escalationId, assigneeId: before.assigneeId ?? null, dueDate: before.dueDate ?? null, status: before.status ?? null },
      after: { escalationId, decision, comment },
      requestId,
    });
    return resolved;
  });

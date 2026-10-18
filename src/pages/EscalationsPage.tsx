import { useCallback, useEffect, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { useUser } from '../hooks/useUser';
import { listOpenEscalations, resolveEscalation } from '../services/automationService';
import type { EscalationView } from '../services/automationService';
import { describeApiError } from '../utils/apiErrors';
import LoadingState from "../components/ui/LoadingState";
import { useToastMessage } from "../hooks/useToast";

type Decision = 'REASSIGN' | 'EXTEND_DEADLINE' | 'ACCEPT_DELAY';
const DECISION_LABELS: Record<Decision, string> = { REASSIGN: 'Reassign', EXTEND_DEADLINE: 'Extend the deadline', ACCEPT_DELAY: 'Accept the delay' };

function EscalationsPage() {
  const { isManager, organisationStatus } = useUser();
  const [items, setItems] = useState<EscalationView[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  useToastMessage(error, "error", () => setError(null));
  const [busy, setBusy] = useState<string | null>(null);
  const [decisions, setDecisions] = useState<Record<string, Decision>>({});

  const reload = useCallback(async () => {
    setLoading(true);
    try { setItems(await listOpenEscalations()); setError(null); }
    catch (err) { setError(describeApiError(err)); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void reload(); }, [reload]);

  // Roles are known once the user is loaded: don't send a manager away before that.
  if (organisationStatus === "loading") return <LoadingState className="empty-state panel" />;
  if (!isManager) return <Navigate to="/" replace />;

  async function submit(form: HTMLFormElement, item: EscalationView) {
    if (!item.task) return;
    const data = new FormData(form);
    const decision = (data.get('decision') as Decision) || 'ACCEPT_DELAY';
    setBusy(item.escalation.id);
    setError(null);
    try {
      await resolveEscalation({
        escalationId: item.escalation.id,
        decision,
        comment: String(data.get('comment') ?? ''),
        newAssigneeEmail: String(data.get('newAssigneeEmail') ?? '') || undefined,
        newDueDate: String(data.get('newDueDate') ?? '') || undefined,
      });
      await reload();
    } catch (err) { setError(describeApiError(err)); }
    finally { setBusy(null); }
  }

  return <div className="page-stack">
    <section className="panel">
      <h2 className="panel__title">Open escalations</h2>

      {loading ? <LoadingState>Loading escalations…</LoadingState> : items.length === 0 ? <p className="empty-state">No open escalations.</p> : items.map((item) => {
        const decision = decisions[item.escalation.id] ?? 'ACCEPT_DELAY';
        return <article key={item.escalation.id} className="panel escalation-card">
          <h3>{item.task?.title ?? 'Task not found'}</h3>
          <p><strong>Project:</strong> {item.project?.name ?? '—'} · <strong>Assignee:</strong> {item.assignee?.name ?? 'Unassigned'} · <strong>Overdue:</strong> {item.daysLate} day(s)</p>
          <p>{item.escalation.reason}</p>
          <p><strong>Impacted tasks:</strong> {item.impactedTasks.map((task) => task.title).join(', ') || 'None'}</p>
          <form onSubmit={(event) => { event.preventDefault(); void submit(event.currentTarget, item); }} className="escalation-form">
            <label className="form-field"><span className="form-field__label">Decision</span><select className="form-input" name="decision" value={decision} onChange={(event) => setDecisions((current) => ({ ...current, [item.escalation.id]: event.target.value as Decision }))}>{Object.entries(DECISION_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
            {decision === 'REASSIGN' && <label className="form-field"><span className="form-field__label">New assignee's email</span><input className="form-input" type="email" name="newAssigneeEmail" required /></label>}
            {decision === 'EXTEND_DEADLINE' && <label className="form-field"><span className="form-field__label">New due date</span><input className="form-input" type="date" name="newDueDate" required /></label>}
            <label className="form-field escalation-form__comment"><span className="form-field__label">Comment</span><textarea className="form-input form-textarea" name="comment" rows={2} maxLength={1000} /></label>
            <button className="button-primary" type="submit" disabled={busy === item.escalation.id}>{busy === item.escalation.id ? 'Saving…' : 'Resolve escalation'}</button>
          </form>
        </article>;
      })}
    </section>
  </div>;
}

export default EscalationsPage;

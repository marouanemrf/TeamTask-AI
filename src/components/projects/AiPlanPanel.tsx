import { useId, useMemo, useState } from "react";
import type { FormEvent } from "react";
import { isUnavailable, rankOwners, SCOPE_MAX, SCOPE_MIN } from "../../../amplify/functions/shared/planning";
import type { PlanMember } from "../../../amplify/functions/shared/planning";
import { usePlanning } from "../../hooks/usePlanning";
import type { Project, Task, TeamMember } from "../../services/client";
import { planPayload } from "../../services/planningService";
import type { PlannedTask, Recommendation } from "../../services/planningService";
import { PRIORITY_LABELS, TASK_PRIORITIES } from "../../utils/projectLabels";
import { isOpenTask } from "../../utils/taskRules";
import LoadingState from "../ui/LoadingState";
import { useToastMessage } from "../../hooks/useToast";

const STATUS: Record<NonNullable<Recommendation["status"]>, { label: string; badge: string }> = {
  GENERATING: { label: "Generating", badge: "badge--blue" },
  PENDING: { label: "Waiting for approval", badge: "badge--amber" },
  APPROVED: { label: "Approved, creating tasks", badge: "badge--blue" },
  APPLIED: { label: "Tasks created", badge: "badge--teal" },
  REJECTED: { label: "Rejected", badge: "badge--gray" },
  EXPIRED: { label: "Expired", badge: "badge--gray" },
  FAILED: { label: "Failed", badge: "badge--red" },
};

const SOURCE_LABEL: Record<PlannedTask["assigneeSource"], string> = { AI: "AI", RULES: "Rules", MANAGER: "You" };

interface Props {
  project: Project;
  members: readonly TeamMember[];
  allTasks: readonly Task[];
  today: string;
  /** Opens the Kanban once tasks are created. */
  onShowBoard: () => void;
}

/**
 * AI planning for managers: describe the scope, the AI proposes work packages (owner, priority,
 * estimate, due date, dependencies), the manager edits and approves or rejects. Tasks are created
 * by the server workflow only after approval.
 */
function AiPlanPanel({ project, members, allTasks, today, onShowBoard }: Props) {
  const id = useId();
  const planning = usePlanning(project.id);
  useToastMessage(planning.error, "error", planning.clearError);
  const [scope, setScope] = useState(project.objective ?? "");
  const [scopeError, setScopeError] = useState<string | null>(null);

  const active = planning.plans.find((p) => p.status === "GENERATING" || p.status === "PENDING" || p.status === "APPROVED");
  const latest = active ?? planning.plans[0];
  const history = planning.plans.filter((p) => p !== latest);

  async function handleRequest(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const clean = scope.trim();
    if (clean.length < SCOPE_MIN) return setScopeError(`Describe the scope in at least ${SCOPE_MIN} characters.`);
    if (clean.length > SCOPE_MAX) return setScopeError(`The scope must be at most ${SCOPE_MAX} characters.`);
    setScopeError(null);
    await planning.request(clean);
  }

  if (planning.loading) return <LoadingState className="empty-state panel">Loading plans…</LoadingState>;

  return (
    <div className="page-stack">

      {!active && (
        <form className="panel" onSubmit={(e) => void handleRequest(e)} noValidate>
          <h2 className="panel__title">Plan with AI</h2>
          <p className="form-hint">
            Describe what needs to be delivered. The AI proposes tasks and subtasks with an owner (skills, capacity and availability),
            a priority, an estimate, a due date and dependencies. You review and edit the plan; nothing is created until you approve it.
          </p>
          <div className="form-field">
            <label className="form-field__label" htmlFor={`${id}-scope`}>Scope and objectives</label>
            <textarea
              id={`${id}-scope`}
              className="form-textarea"
              rows={5}
              value={scope}
              maxLength={SCOPE_MAX}
              aria-invalid={!!scopeError}
              aria-describedby={scopeError ? `${id}-scope-error` : undefined}
              onChange={(e) => setScope(e.target.value)}
              placeholder="e.g. Security assessment for the client: AWS security review, IAM access review, vulnerability assessment, incident response review, ISO 27001 gap analysis and a consolidated report."
            />
            {scopeError && <p id={`${id}-scope-error`} className="form-field__error">{scopeError}</p>}
          </div>
          <div className="form-row-end">
            <button type="submit" className="button-primary" disabled={planning.busy}>
              {planning.busy && <span className="spinner" aria-hidden="true" />}
              <span>Generate plan</span>
            </button>
          </div>
        </form>
      )}

      {latest && <PlanCard key={`${latest.id}:${latest.status}`} plan={latest} project={project} members={members} allTasks={allTasks} today={today} planning={planning} onShowBoard={onShowBoard} />}

      {history.length > 0 && (
        <section className="panel" aria-labelledby={`${id}-history`}>
          <h2 id={`${id}-history`} className="panel__title">Earlier plans</h2>
          <div className="table-wrapper">
            <table className="data-table">
              <thead>
                <tr><th scope="col">Requested</th><th scope="col">By</th><th scope="col">Tasks</th><th scope="col">Status</th><th scope="col">Decision</th></tr>
              </thead>
              <tbody>
                {history.map((p) => {
                  const payload = planPayload(p);
                  const approval = planning.approvals.get(p.id);
                  return (
                    <tr key={p.id}>
                      <td className="nowrap">{new Date(p.createdAt).toLocaleString()}</td>
                      <td>{p.requestedBy ?? "—"}</td>
                      <td>{payload.approvedPlan?.tasks.length ?? payload.plan?.tasks.length ?? 0}</td>
                      <td><span className={`badge ${STATUS[p.status ?? "FAILED"].badge}`}>{STATUS[p.status ?? "FAILED"].label}</span>{p.error ? <span className="form-hint"> {p.error}</span> : null}</td>
                      <td>{approval ? `${approval.decision === "APPROVED" ? "Approved" : "Rejected"} by ${approval.approverEmail} on ${new Date(approval.decidedAt ?? approval.createdAt).toLocaleString()}${approval.comment ? ` — “${approval.comment}”` : ""}` : "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}

interface CardProps {
  plan: Recommendation;
  project: Project;
  members: readonly TeamMember[];
  allTasks: readonly Task[];
  today: string;
  planning: ReturnType<typeof usePlanning>;
  onShowBoard: () => void;
}

/** The current plan: progress, review form, or outcome. */
function PlanCard({ plan, project, members, allTasks, today, planning, onShowBoard }: CardProps) {
  const id = useId();
  const payload = planPayload(plan);
  const proposal = payload.plan;
  const [rows, setRows] = useState(() => (proposal?.tasks ?? []).map((t) => ({ ...t, keep: true })));
  const [comment, setComment] = useState("");
  const approval = planning.approvals.get(plan.id);
  const status = STATUS[plan.status ?? "FAILED"];

  // Members with their current load, for owner choices (same rules as the server).
  const planMembers: PlanMember[] = useMemo(() => {
    const open = new Map<string, number>();
    for (const t of allTasks) if (t.assigneeId && isOpenTask(t)) open.set(t.assigneeId, (open.get(t.assigneeId) ?? 0) + (t.estimatedHours ?? 0));
    return members.map((m) => ({
      id: m.id, name: m.name, jobTitle: m.jobTitle, skills: (m.skills ?? []).filter((s): s is string => !!s), role: m.role, roles: m.roles,
      weeklyCapacityHours: m.weeklyCapacityHours ?? 40, openHours: open.get(m.id) ?? 0, unavailableFrom: m.unavailableFrom, unavailableUntil: m.unavailableUntil,
    }));
  }, [members, allTasks]);
  const memberName = (memberId: string) => members.find((m) => m.id === memberId)?.name ?? "Unknown member";
  const kept = rows.filter((r) => r.keep);
  const titleOf = (key: string) => rows.find((r) => r.key === key)?.title ?? key;

  const update = (key: string, change: Partial<(typeof rows)[number]>) => setRows((all) => all.map((r) => (r.key === key ? { ...r, ...change } : r)));

  if (plan.status === "GENERATING") return <LoadingState className="empty-state panel">The AI is preparing the plan…</LoadingState>;
  if (plan.status === "APPROVED") return <LoadingState className="empty-state panel">Plan approved. Creating the tasks…</LoadingState>;

  if (plan.status !== "PENDING" || !proposal) {
    return (
      <section className="panel" aria-labelledby={`${id}-outcome`}>
        <h2 id={`${id}-outcome`} className="panel__title">Latest plan <span className={`badge ${status.badge}`}>{status.label}</span></h2>
        {plan.status === "APPLIED" && (
          <p>
            {Object.keys(payload.createdTaskIds ?? {}).length} tasks were created from the approved plan.{" "}
            <button type="button" className="text-button" onClick={onShowBoard}>Open the Kanban board</button>
          </p>
        )}
        {plan.error && <p className="form-warning">{plan.error}</p>}
        {approval && (
          <p className="form-hint">
            {approval.decision === "APPROVED" ? "Approved" : "Rejected"} by {approval.approverEmail} on {new Date(approval.decidedAt ?? approval.createdAt).toLocaleString()}
            {approval.comment ? ` — “${approval.comment}”` : ""}
          </p>
        )}
      </section>
    );
  }

  return (
    <section className="panel ai-plan" aria-labelledby={`${id}-title`}>
      <h2 id={`${id}-title`} className="panel__title">
        Proposed plan <span className="chip chip--ai">AI</span> <span className={`badge ${status.badge}`}>{status.label}</span>
      </h2>
      {proposal.summary && <p>{proposal.summary}</p>}
      <p className="form-hint">
        Requested by {plan.requestedBy} on {new Date(plan.createdAt).toLocaleString()}{payload.model ? ` · model ${payload.model}` : ""}. Review every task: uncheck what you don't want and change owners, dates or priorities. Owners marked “Rules” replaced an invalid AI choice.
      </p>
      {proposal.warnings.length > 0 && (
        <ul className="form-warning ai-plan__warnings">
          {proposal.warnings.map((w) => <li key={w}>{w}</li>)}
        </ul>
      )}

      <div className="table-wrapper">
        <table className="data-table ai-plan__table">
          <thead>
            <tr>
              <th scope="col">Keep</th><th scope="col">Task</th><th scope="col">Owner</th><th scope="col">Priority</th><th scope="col">Hours</th><th scope="col">Due</th><th scope="col">Depends on</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const day = r.dueDate ?? today;
              const options = rankOwners(planMembers, r.requiredSkills, r.estimatedHours, day);
              const ownerAway = planMembers.find((m) => m.id === r.assigneeId);
              return (
                <tr key={r.key} className={r.keep ? undefined : "data-table__row--muted"}>
                  <td><input type="checkbox" aria-label={`Keep “${r.title}”`} checked={r.keep} onChange={(e) => update(r.key, { keep: e.target.checked })} /></td>
                  <td>
                    <input className="form-input" aria-label="Title" value={r.title} maxLength={200} disabled={!r.keep} onChange={(e) => update(r.key, { title: e.target.value })} />
                    {r.parentKey && <p className="form-hint">Subtask of “{titleOf(r.parentKey)}”</p>}
                    {r.description && <p className="form-hint">{r.description}</p>}
                    {r.requiredSkills.length > 0 && <p className="form-hint">Skills: {r.requiredSkills.join(", ")}</p>}
                  </td>
                  <td>
                    <select className="form-input" aria-label={`Owner of “${r.title}”`} value={r.assigneeId} disabled={!r.keep} onChange={(e) => update(r.key, { assigneeId: e.target.value, assigneeSource: "MANAGER", assigneeReason: "Chosen by the manager." })}>
                      {!options.some((o) => o.member.id === r.assigneeId) && <option value={r.assigneeId}>{memberName(r.assigneeId)} (not available)</option>}
                      {options.map((o) => (
                        <option key={o.member.id} value={o.member.id}>{o.member.name} · {o.matches} skill{o.matches === 1 ? "" : "s"} · {o.projectedPercent}%</option>
                      ))}
                    </select>
                    <p className="form-hint"><span className="badge badge--muted">{SOURCE_LABEL[r.assigneeSource]}</span> {r.assigneeReason}</p>
                    {ownerAway && isUnavailable(ownerAway, day) && <p className="form-warning">Unavailable on {day}.</p>}
                  </td>
                  <td>
                    <select className="form-input" aria-label="Priority" value={r.priority} disabled={!r.keep} onChange={(e) => update(r.key, { priority: e.target.value as typeof r.priority })}>
                      {TASK_PRIORITIES.map((p) => <option key={p} value={p}>{PRIORITY_LABELS[p]}</option>)}
                    </select>
                  </td>
                  <td>
                    <input className="form-input form-input--narrow" type="number" min={0.5} max={200} step={0.5} aria-label="Estimated hours" value={r.estimatedHours} disabled={!r.keep} onChange={(e) => update(r.key, { estimatedHours: Number(e.target.value) || 0.5 })} />
                  </td>
                  <td>
                    <input className="form-input" type="date" aria-label="Due date" value={r.dueDate ?? ""} min={project.startDate ?? undefined} max={project.endDate ?? undefined} disabled={!r.keep} onChange={(e) => update(r.key, { dueDate: e.target.value || null })} />
                  </td>
                  <td>{r.dependsOn.length ? r.dependsOn.map(titleOf).join(", ") : "—"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="form-field">
        <label className="form-field__label" htmlFor={`${id}-comment`}>Comment (optional)</label>
        <textarea id={`${id}-comment`} className="form-textarea" rows={2} maxLength={1000} value={comment} onChange={(e) => setComment(e.target.value)} />
      </div>
      <div className="form-row-end">
        <button type="button" className="button-secondary" disabled={planning.busy} onClick={() => void planning.reject(plan.id, comment)}>Reject plan</button>
        <button
          type="button"
          className="button-primary"
          disabled={planning.busy || kept.length === 0 || kept.some((r) => !r.title.trim())}
          onClick={() => void planning.approve(plan.id, kept.map(({ keep: _keep, ...task }) => ({ ...task, title: task.title.trim() })), comment)}
        >
          {planning.busy && <span className="spinner" aria-hidden="true" />}
          <span>Approve and create {kept.length} task{kept.length === 1 ? "" : "s"}</span>
        </button>
      </div>
    </section>
  );
}

export default AiPlanPanel;

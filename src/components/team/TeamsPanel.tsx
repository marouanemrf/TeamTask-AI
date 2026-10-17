import { useId, useState } from "react";
import type { FormEvent } from "react";
import type { TeamMember } from "../../services/client";
import type { TeamGroup } from "../../services/teamGroupService";
import { useToastMessage } from "../../hooks/useToast";

interface Props {
  teams: readonly TeamGroup[];
  members: readonly TeamMember[];
  canManage: boolean;
  busy: boolean;
  error: string | null;
  onCreate: (input: { name: string; description?: string; leadMemberId?: string | null }) => Promise<boolean>;
  onDelete: (team: TeamGroup, memberCount: number) => Promise<boolean>;
}

/** Teams of the organisation: name, lead, members. Managers add teams and delete empty ones. */
function TeamsPanel({ teams, members, canManage, busy, error, onCreate, onDelete }: Props) {
  const id = useId();
  useToastMessage(error, "error");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [lead, setLead] = useState("");
  const [nameError, setNameError] = useState<string | null>(null);
  const count = (teamId: string) => members.filter((m) => m.teamId === teamId).length;
  const memberName = (memberId: string | null | undefined) => members.find((m) => m.id === memberId)?.name ?? "—";

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const clean = name.trim();
    if (!clean || clean.length > 80) return setNameError("Enter a team name (up to 80 characters).");
    if (teams.some((t) => t.name.toLowerCase() === clean.toLowerCase())) return setNameError("A team already has this name.");
    setNameError(null);
    if (await onCreate({ name: clean, description, leadMemberId: lead || null })) {
      setName("");
      setDescription("");
      setLead("");
    }
  }

  return (
    <section className="panel" aria-labelledby={`${id}-title`}>
      <h2 id={`${id}-title`} className="panel__title">Teams</h2>
      {teams.length === 0 ? (
        <p className="text-muted">No teams yet.{canManage ? " Create one below, then choose it in each member's account." : ""}</p>
      ) : (
        <div className="table-wrapper">
          <table className="data-table">
            <thead>
              <tr><th scope="col">Team</th><th scope="col">Lead</th><th scope="col">Members</th>{canManage && <th scope="col"><span className="visually-hidden">Actions</span></th>}</tr>
            </thead>
            <tbody>
              {teams.map((t) => (
                <tr key={t.id}>
                  <td><strong>{t.name}</strong>{t.description && <p className="form-hint">{t.description}</p>}</td>
                  <td>{memberName(t.leadMemberId)}</td>
                  <td>{count(t.id)}</td>
                  {canManage && (
                    <td>
                      <button type="button" className="text-button" disabled={busy || count(t.id) > 0} title={count(t.id) > 0 ? "Move the members first" : undefined} onClick={() => void onDelete(t, count(t.id))}>
                        Delete
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {canManage && (
        <form className="teams-panel__form" onSubmit={(e) => void handleSubmit(e)} noValidate>
          <div className="form-field">
            <label className="form-field__label" htmlFor={`${id}-name`}>New team</label>
            <input id={`${id}-name`} className="form-input" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} aria-invalid={!!nameError} aria-describedby={nameError ? `${id}-name-error` : undefined} placeholder="e.g. Cloud security" />
            {nameError && <p id={`${id}-name-error`} className="form-field__error">{nameError}</p>}
          </div>
          <div className="form-field">
            <label className="form-field__label" htmlFor={`${id}-desc`}>Description</label>
            <input id={`${id}-desc`} className="form-input" value={description} maxLength={300} onChange={(e) => setDescription(e.target.value)} />
          </div>
          <div className="form-field">
            <label className="form-field__label" htmlFor={`${id}-lead`}>Lead</label>
            <select id={`${id}-lead`} className="form-input" value={lead} onChange={(e) => setLead(e.target.value)}>
              <option value="">None</option>
              {members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
            </select>
          </div>
          <button type="submit" className="button-primary" disabled={busy}>
            {busy && <span className="spinner" aria-hidden="true" />}
            <span>Add team</span>
          </button>
        </form>
      )}
    </section>
  );
}

export default TeamsPanel;

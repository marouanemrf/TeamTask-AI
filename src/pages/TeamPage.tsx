import { useId, useMemo, useState } from "react";
import MemberCard from "../components/team/MemberCard";
import MemberFormModal from "../components/team/MemberFormModal";
import TeamsPanel from "../components/team/TeamsPanel";
import { useTeamGroups } from "../hooks/useTeamGroups";
import { PlusIcon, SearchIcon } from "../components/ui/Icons";
import { useTasks } from "../hooks/useTasks";
import { useMemberActions, useTeamMembers } from "../hooks/useTeam";
import { useUser } from "../hooks/useUser";
import type { TeamRole } from "../services/client";
import type { AvatarChange, MemberInput } from "../services/teamService";
import { ROLES, ROLE_LABELS } from "../utils/roles";
import { isOpenTask } from "../utils/taskStats";
import LoadingState from "../components/ui/LoadingState";

type RoleFilter = TeamRole | "ALL";

function TeamPage() {
  const id = useId();
  const { isManager, isAdmin } = useUser();
  const { members, loading, error } = useTeamMembers();
  const { tasks } = useTasks();
  const { create, submitting, error: saveError, clearError } = useMemberActions();
  const [query, setQuery] = useState("");
  const [role, setRole] = useState<RoleFilter>("ALL");
  const [teamFilter, setTeamFilter] = useState("ALL");
  const teamGroups = useTeamGroups();
  const [modalOpen, setModalOpen] = useState(false);

  // Open tasks per assignee.
  const openTaskCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const task of tasks) {
      if (task.assigneeId && isOpenTask(task)) counts.set(task.assigneeId, (counts.get(task.assigneeId) ?? 0) + 1);
    }
    return counts;
  }, [tasks]);

  // Search by name, @username or skill, filter by role; alphabetical.
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return members
      .filter((m) => role === "ALL" || (m.roles?.length ? m.roles.some((r) => r === role) : (m.role ?? "VIEWER") === role))
      .filter((m) => teamFilter === "ALL" || (teamFilter === "NONE" ? !m.teamId : m.teamId === teamFilter))
      .filter(
        (m) =>
          !q ||
          m.name.toLowerCase().includes(q) ||
          (m.username ?? "").toLowerCase().includes(q.replace(/^@/, "")) ||
          (m.skills ?? []).some((skill) => skill?.toLowerCase().includes(q)),
      )
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [members, query, role, teamFilter]);

  async function handleCreate(input: MemberInput, avatar: AvatarChange) {
    return (await create(input, avatar)) !== null;
  }

  function openModal() {
    clearError();
    setModalOpen(true);
  }

  return (
    <div className="page-stack">
      {/* Toolbar */}
      <div className="toolbar">
        <div className="search-field">
          <label className="visually-hidden" htmlFor={`${id}-search`}>
            Search members
          </label>
          <SearchIcon />
          <input
            id={`${id}-search`}
            type="search"
            className="form-input"
            placeholder="Search by name, @username or skill"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <div className="toolbar__filter">
          <label className="visually-hidden" htmlFor={`${id}-role`}>
            Filter by role
          </label>
          <select id={`${id}-role`} className="form-input" value={role} onChange={(e) => setRole(e.target.value as RoleFilter)}>
            <option value="ALL">All roles</option>
            {ROLES.map((r) => (
              <option key={r} value={r}>
                {ROLE_LABELS[r]}
              </option>
            ))}
          </select>
        </div>
        {teamGroups.teams.length > 0 && (
          <div className="toolbar__filter">
            <label className="visually-hidden" htmlFor={`${id}-team`}>Filter by team</label>
            <select id={`${id}-team`} className="form-input" value={teamFilter} onChange={(e) => setTeamFilter(e.target.value)}>
              <option value="ALL">All teams</option>
              {teamGroups.teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              <option value="NONE">No team</option>
            </select>
          </div>
        )}
        {isManager && (
          <button type="button" className="button-primary button-primary--inline" onClick={openModal}>
            <PlusIcon />
            <span>Add member</span>
          </button>
        )}
      </div>


      {/* Members */}
      {loading ? (
        <LoadingState className="empty-state panel">Loading team…</LoadingState>
      ) : error ? (
        <div className="form-alert" role="alert">
          <span>Unable to load the team. Please try again.</span>
        </div>
      ) : members.length === 0 ? (
        <p className="empty-state panel">No team members yet.</p>
      ) : filtered.length === 0 ? (
        <p className="empty-state panel">No members match your search.</p>
      ) : (
        <ul className="member-grid">
          {filtered.map((member) => (
            <li key={member.id}>
              <MemberCard member={member} openTaskCount={openTaskCounts.get(member.id) ?? 0} />
            </li>
          ))}
        </ul>
      )}

      {!loading && !error && teamGroups.available && (
        <TeamsPanel teams={teamGroups.teams} members={members} canManage={isManager} busy={teamGroups.busy} error={teamGroups.error} onCreate={teamGroups.create} onDelete={teamGroups.remove} />
      )}

      {modalOpen && (
        <MemberFormModal
          teams={teamGroups.teams}
          existingEmails={members.map((m) => m.email)}
          existingUsernames={members.flatMap((m) => (m.username ? [m.username] : []))}
          submitting={submitting}
          error={saveError}
          onSubmit={handleCreate}
          onClose={() => setModalOpen(false)}
          canGrantPrivileged={isAdmin}
        />
      )}
    </div>
  );
}

export default TeamPage;

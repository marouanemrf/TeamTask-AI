import { useId, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import ProjectsTable from "../components/projects/ProjectsTable";
import type { ProjectRow } from "../components/projects/ProjectsTable";
import { PlusIcon, SearchIcon } from "../components/ui/Icons";
import { useProjects } from "../hooks/useProjects";
import { useTasks } from "../hooks/useTasks";
import { useUser } from "../hooks/useUser";
import type { ProjectStatus } from "../services/client";
import { PROJECT_STATUSES, PROJECT_STATUS_LABELS } from "../utils/projectLabels";
import { ROUTES } from "../utils/routes";
import { projectProgress } from "../utils/taskRules";
import { groupTasksByProject } from "../utils/taskStats";

type StatusFilter = ProjectStatus | "ALL";

function ProjectsListPage() {
  const id = useId();
  const { isManager } = useUser();
  const { projects, loading, error } = useProjects();
  const { tasks } = useTasks();
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<StatusFilter>("ALL");

  // Newest first, with progress = share of DONE tasks.
  const rows = useMemo<ProjectRow[]>(() => {
    const byProject = groupTasksByProject(tasks);
    return [...projects]
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .map((project) => {
        const projectTasks = byProject.get(project.id) ?? [];
        const progress = projectProgress(projectTasks);
        return { project, progress: progress.total ? progress.percent : null };
      });
  }, [projects, tasks]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter(({ project }) => {
      if (status !== "ALL" && project.status !== status) return false;
      if (!q) return true;
      return (
        project.name.toLowerCase().includes(q) ||
        (project.clientName ?? "").toLowerCase().includes(q)
      );
    });
  }, [rows, query, status]);

  return (
    <div className="page-stack">
      {/* Toolbar: search, status filter, create */}
      <div className="toolbar">
        <div className="search-field">
          <label className="visually-hidden" htmlFor={`${id}-search`}>
            Search projects
          </label>
          <SearchIcon />
          <input
            id={`${id}-search`}
            type="search"
            className="form-input"
            placeholder="Search by name or client"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <div className="toolbar__filter">
          <label className="visually-hidden" htmlFor={`${id}-status`}>
            Filter by status
          </label>
          <select
            id={`${id}-status`}
            className="form-input"
            value={status}
            onChange={(e) => setStatus(e.target.value as StatusFilter)}
          >
            <option value="ALL">All statuses</option>
            {PROJECT_STATUSES.map((s) => (
              <option key={s} value={s}>
                {PROJECT_STATUS_LABELS[s]}
              </option>
            ))}
          </select>
        </div>
        {isManager && (
          <Link className="button-primary button-primary--inline" to={ROUTES.projectNew}>
            <PlusIcon />
            <span>New project</span>
          </Link>
        )}
      </div>

      {/* Results */}
      <p className="visually-hidden" role="status">
        {loading ? "" : `${filtered.length} project${filtered.length === 1 ? "" : "s"} shown`}
      </p>
      {loading ? (
        <p className="empty-state panel">Loading projects…</p>
      ) : error ? (
        <div className="form-alert" role="alert">
          <span>Unable to load projects. Please try again.</span>
        </div>
      ) : rows.length === 0 ? (
        <p className="empty-state panel">No projects yet.</p>
      ) : filtered.length === 0 ? (
        <p className="empty-state panel">No projects match your search.</p>
      ) : (
        <ProjectsTable rows={filtered} />
      )}
    </div>
  );
}

export default ProjectsListPage;

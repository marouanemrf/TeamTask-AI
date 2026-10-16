import { Link, useNavigate } from "react-router-dom";
import type { Project } from "../../services/client";
import { formatDate } from "../../utils/dates";
import { projectPath } from "../../utils/routes";
import StatusBadge from "../ui/StatusBadge";

export interface ProjectRow {
  project: Project;
  /** Percentage of DONE tasks, or null when the project has no tasks. */
  progress: number | null;
}

/**
 * Projects table. The whole row is clickable with a mouse; keyboard users reach the
 * project through the link in the name cell.
 */
function ProjectsTable({ rows }: { rows: ProjectRow[] }) {
  const navigate = useNavigate();

  return (
    <div className="table-wrapper">
      <table className="data-table">
        <thead>
          <tr>
            <th scope="col">Name</th>
            <th scope="col">Client</th>
            <th scope="col">Status</th>
            <th scope="col">Start date</th>
            <th scope="col">End date</th>
            <th scope="col">Progress</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(({ project, progress }) => (
            <tr key={project.id} className="data-table__row" onClick={() => navigate(projectPath(project.id))}>
              <td>
                <Link className="data-table__link" to={projectPath(project.id)} onClick={(e) => e.stopPropagation()}>
                  {project.name}
                </Link>
              </td>
              <td className="text-muted">{project.clientName || "—"}</td>
              <td>
                <StatusBadge status={project.status} />
              </td>
              <td className="nowrap">{formatDate(project.startDate)}</td>
              <td className="nowrap">{formatDate(project.endDate)}</td>
              <td>
                {progress === null ? (
                  <span className="text-muted">—</span>
                ) : (
                  <span className="progress">
                    <span className="progress__track" aria-hidden="true">
                      <span className="progress__bar" style={{ width: `${progress}%` }} />
                    </span>
                    <span className="progress__value">{progress}%</span>
                  </span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default ProjectsTable;

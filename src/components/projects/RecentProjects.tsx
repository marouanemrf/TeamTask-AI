import { Link } from "react-router-dom";
import type { Project } from "../../services/client";
import { projectPath } from "../../utils/routes";
import StatusBadge from "../ui/StatusBadge";

function RecentProjects({ projects }: { projects: Project[] }) {
  if (projects.length === 0) {
    return <p className="empty-state">No projects yet.</p>;
  }

  return (
    <ul className="item-list">
      {projects.map((project) => (
        <li key={project.id} className="item-list__item">
          <span className="item-list__main">
            <Link className="item-list__link" to={projectPath(project.id)}>
              {project.name}
            </Link>
            {project.clientName && <span className="item-list__meta">{project.clientName}</span>}
          </span>
          <StatusBadge status={project.status} />
        </li>
      ))}
    </ul>
  );
}

export default RecentProjects;

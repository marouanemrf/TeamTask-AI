import type { Project } from "../../services/client";
import { formatDate } from "../../utils/dates";
import StatusBadge from "../ui/StatusBadge";
import { EditIcon } from "../ui/Icons";

export interface ProjectHeaderProps {
  project: Project;
  progress: { done: number; total: number; percent: number };
  canEdit: boolean;
  onEdit: () => void;
}

/** Project summary: identity, dates, manager, collapsible objective and progress (DONE / non-cancelled tasks). */
function ProjectHeader({ project, progress, canEdit, onEdit }: ProjectHeaderProps) {
  return (
    <section className="panel project-header" aria-labelledby="project-title">
      <div className="project-header__top">
        <div className="project-header__identity">
          <h2 id="project-title" className="project-header__name">
            {project.name}
          </h2>
          <p className="text-muted">{project.clientName || "No client"}</p>
        </div>
        <StatusBadge status={project.status} />
        {canEdit && (
          <button type="button" className="button-secondary project-header__edit" onClick={onEdit}>
            <EditIcon />
            <span>Edit project</span>
          </button>
        )}
      </div>

      <dl className="project-header__facts">
        <div>
          <dt>Start</dt>
          <dd>{formatDate(project.startDate)}</dd>
        </div>
        <div>
          <dt>End</dt>
          <dd>{formatDate(project.endDate)}</dd>
        </div>
        <div>
          <dt>Manager</dt>
          <dd className="project-header__manager">{project.managerEmail || "—"}</dd>
        </div>
      </dl>

      {project.objective && (
        <details className="project-header__objective">
          <summary>Objective</summary>
          <p>{project.objective}</p>
        </details>
      )}

      <div className="project-progress">
        <div className="project-progress__label">
          <span>Progress</span>
          <span>
            {progress.percent}% · {progress.done} of {progress.total} tasks done
          </span>
        </div>
        <div
          className="project-progress__track"
          role="progressbar"
          aria-label="Project progress"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={progress.percent}
          aria-valuetext={`${progress.percent}%, ${progress.done} of ${progress.total} tasks done (cancelled tasks excluded)`}
        >
          <span className="project-progress__bar" style={{ width: `${progress.percent}%` }} />
        </div>
      </div>
    </section>
  );
}

export default ProjectHeader;

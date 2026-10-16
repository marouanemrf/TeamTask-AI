import type { ProjectStatus } from "../../services/client";
import { PROJECT_STATUS_LABELS } from "../../utils/projectLabels";

const STATUS_CLASS: Record<ProjectStatus, string> = {
  DRAFT: "badge--gray",
  ACTIVE: "badge--teal",
  ON_HOLD: "badge--amber",
  CLOSED: "badge--muted",
};

/** Colored project status pill. The label carries the meaning, so color is never the only cue. */
function StatusBadge({ status }: { status: ProjectStatus | null | undefined }) {
  if (!status) return <span className="badge badge--muted">—</span>;
  return <span className={`badge ${STATUS_CLASS[status]}`}>{PROJECT_STATUS_LABELS[status]}</span>;
}

export default StatusBadge;

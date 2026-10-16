import type { TaskPriority } from "../../services/client";
import { PRIORITY_LABELS } from "../../utils/projectLabels";

const PRIORITY_CLASS: Record<TaskPriority, string> = {
  LOW: "badge--gray",
  MEDIUM: "badge--blue",
  HIGH: "badge--amber",
  CRITICAL: "badge--red",
};

/** LOW gray, MEDIUM blue, HIGH amber, CRITICAL red — the label is always shown too. */
function PriorityBadge({ priority }: { priority: TaskPriority | null | undefined }) {
  if (!priority) return null;
  return <span className={`badge ${PRIORITY_CLASS[priority]}`}>{PRIORITY_LABELS[priority]}</span>;
}

export default PriorityBadge;

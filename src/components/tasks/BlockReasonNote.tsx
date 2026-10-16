import { formatDateTime } from "../../utils/dates";
import type { BlockReason } from "../../utils/taskRules";
import { FlagIcon } from "../ui/Icons";

/** "Blocked: <reason>" note shown on task rows, Kanban cards and the task drawer. */
function BlockReasonNote({ block, compact = false }: { block: BlockReason; compact?: boolean }) {
  return (
    <div className={`block-note${compact ? " block-note--compact" : ""}`}>
      <FlagIcon />
      <div>
        <p className="block-note__reason">
          <strong>Blocked:</strong> {block.reason}
        </p>
        {!compact && (
          <p className="block-note__meta">
            Reported by {block.by ?? "unknown user"} · <time dateTime={block.at}>{formatDateTime(block.at)}</time>
          </p>
        )}
      </div>
    </div>
  );
}

export default BlockReasonNote;

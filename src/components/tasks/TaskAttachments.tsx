import { useCallback, useEffect, useId, useState } from "react";
import { ATTACHMENT_ACCEPT, attachmentUrl, deleteAttachment, listAttachments, uploadAttachment } from "../../services/attachmentService";
import type { Attachment } from "../../services/attachmentService";
import { describeApiError } from "../../utils/apiErrors";
import { formatDateTime } from "../../utils/dates";
import LoadingState from "../ui/LoadingState";

const size = (bytes: number) => (bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`);

/** Documents of a task (S3). Managers and the assignee add files; managers delete them. */
function TaskAttachments({ taskId, canUpload, canDelete }: { taskId: string; canUpload: boolean; canDelete: boolean }) {
  const id = useId();
  const [state, setState] = useState<{ taskId: string; items: Attachment[] } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    let active = true;
    listAttachments(taskId)
      .then((items) => active && setState({ taskId, items }))
      .catch((err) => {
        console.error("[TaskAttachments] List failed", err);
        if (active) {
          setState({ taskId, items: [] });
          setError(describeApiError(err));
        }
      });
    return () => {
      active = false;
    };
  }, [taskId, version]);

  const run = useCallback(async (action: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await action();
      setVersion((v) => v + 1);
    } catch (err) {
      setError(describeApiError(err));
    } finally {
      setBusy(false);
    }
  }, []);

  async function open(attachment: Attachment) {
    try {
      window.open(await attachmentUrl(attachment), "_blank", "noopener");
    } catch (err) {
      setError(describeApiError(err));
    }
  }

  const items = state && state.taskId === taskId ? state.items : null;
  return (
    <>
      <h3 className="drawer__section">Attachments</h3>
      {items === null ? (
        <LoadingState className="text-muted" />
      ) : items.length === 0 ? (
        <p className="text-muted">No attachments.</p>
      ) : (
        <ul className="link-list">
          {items.map((a) => (
            <li key={a.path}>
              <button type="button" className="link-button" onClick={() => void open(a)}>{a.name}</button>
              <span className="text-muted"> {size(a.size)}{a.lastModified ? ` · ${formatDateTime(a.lastModified.toISOString())}` : ""}</span>
              {canDelete && (
                <button type="button" className="text-button" disabled={busy} aria-label={`Delete ${a.name}`} onClick={() => void run(() => deleteAttachment(a))}>Delete</button>
              )}
            </li>
          ))}
        </ul>
      )}
      {canUpload && (
        <p>
          <input
            id={`${id}-file`}
            className="visually-hidden file-input"
            type="file"
            accept={ATTACHMENT_ACCEPT}
            disabled={busy}
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = "";
              if (file) void run(() => uploadAttachment(taskId, file));
            }}
          />
          <label htmlFor={`${id}-file`} className="button-secondary">{busy ? "Uploading…" : "Add a file"}</label>
          <span className="form-hint"> PDF, images, Office, text, CSV, JSON or ZIP · up to 10 MB.</span>
        </p>
      )}
      {error && <p className="form-field__error" role="alert">{error}</p>}
    </>
  );
}

export default TaskAttachments;

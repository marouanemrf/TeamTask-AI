import { getUrl, list, remove, uploadData } from "aws-amplify/storage";
import { ApiError } from "./apiError";

/**
 * Task attachments in the storage bucket, under task-attachments/<taskId>/ (see
 * amplify/storage/resource.ts: managers and members upload, managers delete, everyone signed in
 * reads). Files are named <uuid>-<original name> so two uploads never overwrite each other.
 */
export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;
export const ATTACHMENT_ACCEPT = ".pdf,.png,.jpg,.jpeg,.webp,.txt,.csv,.docx,.xlsx,.pptx,.json,.zip";
const ALLOWED_EXTENSIONS = new Set(ATTACHMENT_ACCEPT.split(",").map((e) => e.slice(1)));

export interface Attachment {
  path: string;
  name: string;
  size: number;
  lastModified?: Date;
}

const folder = (taskId: string) => `task-attachments/${encodeURIComponent(taskId)}/`;

/** The name shown to users: the original file name, without the uuid prefix. */
export function attachmentName(path: string): string {
  const file = path.slice(path.lastIndexOf("/") + 1);
  return file.replace(/^[0-9a-f-]{36}-/, "");
}

/** Problem with a file before upload, or null. */
export function checkAttachment(file: File): string | null {
  const extension = file.name.split(".").pop()?.toLowerCase() ?? "";
  if (!ALLOWED_EXTENSIONS.has(extension)) return "This file type isn't allowed. Use PDF, images, Office documents, text, CSV, JSON or ZIP.";
  if (file.size > MAX_ATTACHMENT_BYTES) return "Files can be up to 10 MB.";
  if (file.size === 0) return "This file is empty.";
  return null;
}

export async function listAttachments(taskId: string): Promise<Attachment[]> {
  const { items } = await list({ path: folder(taskId), options: { listAll: true } });
  return items
    .filter((i) => !i.path.endsWith("/"))
    .map((i) => ({ path: i.path, name: attachmentName(i.path), size: i.size ?? 0, lastModified: i.lastModified }))
    .sort((a, b) => (b.lastModified?.getTime() ?? 0) - (a.lastModified?.getTime() ?? 0));
}

export async function uploadAttachment(taskId: string, file: File): Promise<void> {
  const problem = checkAttachment(file);
  if (problem) throw new ApiError(problem, "VALIDATION");
  const safeName = file.name.replace(/[^A-Za-z0-9._-]+/g, "_").slice(-120);
  await uploadData({ path: `${folder(taskId)}${crypto.randomUUID()}-${safeName}`, data: file, options: { contentType: file.type || "application/octet-stream" } }).result;
}

/** Signed link (5 minutes) that downloads the file under its original name. */
export async function attachmentUrl(attachment: Attachment): Promise<string> {
  const { url } = await getUrl({ path: attachment.path, options: { expiresIn: 300, contentDisposition: { type: "attachment", filename: attachment.name } } });
  return url.toString();
}

export async function deleteAttachment(attachment: Attachment): Promise<void> {
  await remove({ path: attachment.path });
}

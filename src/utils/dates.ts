/** Today as YYYY-MM-DD in the user's local time zone (AWSDate format). */
export function todayIsoDate(): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

const DATE_FORMAT = new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", year: "numeric" });

/** Formats an AWSDate (YYYY-MM-DD) for display, without time-zone shifts. */
export function formatDate(isoDate: string | null | undefined): string {
  if (!isoDate) return "—";
  const [year, month, day] = isoDate.split("-").map(Number);
  if (!year || !month || !day) return isoDate;
  return DATE_FORMAT.format(new Date(year, month - 1, day));
}

/* -------------------------------------------------------------------------- */
/* Date arithmetic & grouping (all on local YYYY-MM-DD strings)                */
/* -------------------------------------------------------------------------- */

function parseIso(isoDate: string): Date {
  const [year, month, day] = isoDate.split("-").map(Number);
  return new Date(year, month - 1, day);
}

function toIso(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** `isoDate` plus `days` (negative to go back). */
export function addDays(isoDate: string, days: number): string {
  const d = parseIso(isoDate);
  d.setDate(d.getDate() + days);
  return toIso(d);
}

/** Sunday of the week containing `isoDate` (weeks run Monday → Sunday). */
export function endOfWeek(isoDate: string): string {
  const day = parseIso(isoDate).getDay(); // 0 = Sunday
  return addDays(isoDate, day === 0 ? 0 : 7 - day);
}

export type DueBucket = "overdue" | "thisWeek" | "later";

/** Groups a due date relative to today: before today, by the end of this week, or later / none. */
export function dueBucket(dueDate: string | null | undefined, today: string): DueBucket {
  if (!dueDate) return "later";
  if (dueDate < today) return "overdue";
  if (dueDate <= endOfWeek(today)) return "thisWeek";
  return "later";
}

/** Whether an ISO date-time is within the last `days` days (inclusive of now). */
export function isWithinLastDays(isoDateTime: string | null | undefined, days: number, now = new Date()): boolean {
  if (!isoDateTime) return false;
  const time = new Date(isoDateTime).getTime();
  return time <= now.getTime() && now.getTime() - time <= days * 24 * 60 * 60 * 1000;
}

const DATE_TIME_FORMAT = new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short" });

/** Formats an ISO date-time (e.g. createdAt) for display. */
export function formatDateTime(isoDateTime: string): string {
  return DATE_TIME_FORMAT.format(new Date(isoDateTime));
}

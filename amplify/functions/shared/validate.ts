import { fail } from "./errors";
import { TASK_PRIORITIES, TASK_STATUSES } from "./rules";
import type { TaskPriorityValue, TaskStatusValue } from "./rules";

/** Input validation: every helper returns the clean value or throws VALIDATION. */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export function requestId(value: unknown): string {
  if (typeof value !== "string" || !UUID.test(value)) fail("VALIDATION", "clientRequestId must be a valid UUID.");
  return value.toLowerCase();
}

export function id(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim() || value.length > 128) fail("VALIDATION", `${field} is required and must be at most 128 characters.`);
  return value.trim();
}

export function optionalId(value: unknown, field: string): string | null {
  if (value === null || value === undefined || value === "") return null;
  return id(value, field);
}

export function text(value: unknown, field: string, { min = 1, max }: { min?: number; max: number }): string {
  const clean = typeof value === "string" ? value.trim() : "";
  if (clean.length < min) fail("VALIDATION", min <= 1 ? `${field} is required.` : `${field} must be at least ${min} characters.`);
  if (clean.length > max) fail("VALIDATION", `${field} must be at most ${max} characters.`);
  return clean;
}

export function optionalText(value: unknown, field: string, max: number): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string") fail("VALIDATION", `${field} must be text.`);
  const clean = value.trim();
  if (clean.length > max) fail("VALIDATION", `${field} must be at most ${max} characters.`);
  return clean || null;
}

export function priority(value: unknown, fallback: TaskPriorityValue): TaskPriorityValue {
  if (value === null || value === undefined || value === "") return fallback;
  if (!(TASK_PRIORITIES as readonly unknown[]).includes(value)) fail("VALIDATION", `Priority must be one of: ${TASK_PRIORITIES.join(", ")}.`);
  return value as TaskPriorityValue;
}

export function status(value: unknown, allowed: readonly TaskStatusValue[] = TASK_STATUSES): TaskStatusValue {
  if (!(allowed as readonly unknown[]).includes(value)) fail("VALIDATION", `Status must be one of: ${allowed.join(", ")}.`);
  return value as TaskStatusValue;
}

export function optionalDate(value: unknown, field: string): string | null {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value !== "string" || !ISO_DATE.test(value) || Number.isNaN(Date.parse(`${value}T00:00:00Z`))) {
    fail("VALIDATION", `${field} must be a valid date (YYYY-MM-DD).`);
  }
  return value;
}

export function optionalHours(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1000) {
    fail("VALIDATION", "Estimated hours must be between 0 and 1,000.");
  }
  return Math.round(value * 100) / 100;
}

export function skills(value: unknown): string[] {
  if (value === null || value === undefined) return [];
  if (!Array.isArray(value) || value.length > 30) fail("VALIDATION", "Required skills can contain at most 30 items.");
  const clean = value.map((s) => text(s, "Skill", { max: 60 }));
  return [...new Map(clean.map((s) => [s.toLowerCase(), s])).values()];
}

export function idList(value: unknown, field: string): string[] | null {
  if (value === null || value === undefined) return null;
  if (!Array.isArray(value) || value.length > 50) fail("VALIDATION", `${field} can contain at most 50 tasks.`);
  return [...new Set(value.map((v) => id(v, field)))];
}

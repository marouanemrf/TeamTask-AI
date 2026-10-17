import type { ProjectStatus, TaskEventType, TaskPriority, TaskStatus } from "../services/client";

export const PROJECT_STATUSES: readonly ProjectStatus[] = ["DRAFT", "ACTIVE", "ON_HOLD", "CLOSED"];

export const PROJECT_STATUS_LABELS: Record<ProjectStatus, string> = {
  DRAFT: "Draft",
  ACTIVE: "Active",
  ON_HOLD: "On hold",
  CLOSED: "Closed",
};

/** Display order for tasks grouped by status (active work first). */
export const TASK_STATUS_ORDER: readonly TaskStatus[] = ["IN_PROGRESS", "BLOCKED", "TODO", "PROPOSED", "DONE", "CANCELLED"];

export const TASK_STATUS_LABELS: Record<TaskStatus, string> = {
  PROPOSED: "Proposed",
  TODO: "To do",
  IN_PROGRESS: "In progress",
  BLOCKED: "Blocked",
  DONE: "Done",
  CANCELLED: "Cancelled",
};

/** Kanban columns, left to right (PROPOSED is shown above the board, CANCELLED only in the list). */
export const BOARD_COLUMNS: readonly TaskStatus[] = ["TODO", "IN_PROGRESS", "BLOCKED", "DONE"];

export const TASK_PRIORITIES: readonly TaskPriority[] = ["LOW", "MEDIUM", "HIGH", "CRITICAL"];

export const PRIORITY_LABELS: Record<TaskPriority, string> = {
  LOW: "Low",
  MEDIUM: "Medium",
  HIGH: "High",
  CRITICAL: "Critical",
};

export const TASK_EVENT_LABELS: Record<TaskEventType, string> = {
  CREATED: "Created",
  UPDATED: "Details updated",
  ASSIGNED: "Assignment changed",
  STATUS_CHANGED: "Status changed",
  APPROVED: "Approved",
  REJECTED: "Rejected",
  REMINDER_SENT: "Reminder sent",
  ESCALATED: "Escalated",
  AI_PROPOSED: "Plan proposed by AI",
};

import { useCallback } from "react";
import { useNavigate } from "react-router-dom";
import type { ActionCard } from "../services/assistantService";
import { assignTask, changeTaskStatus, getTaskForEdit, taskToInput, updateTask } from "../services/taskService";
import type { TaskStatus } from "../services/client";
import { describeApiError } from "../utils/apiErrors";
import { projectPath } from "../utils/routes";

/**
 * Runs an action card after the user clicked "Confirm". It calls the same API as the rest of the
 * app with the user's own session, so every permission and business rule is checked again on the
 * server — the assistant never applies anything itself.
 * Resolves to a user-facing result; rejects with a user-facing message.
 */
export function useAssistantActions() {
  const navigate = useNavigate();

  return useCallback(
    async (card: ActionCard): Promise<string> => {
      try {
        switch (card.type) {
          case "START_PLANNING":
            navigate(projectPath(card.targetId));
            return "Project opened. Plan it from the project page.";
          case "CHANGE_MY_TASK_STATUS":
          case "REPORT_BLOCKER": {
            const { task } = await getTaskForEdit(card.targetId);
            await changeTaskStatus(task, card.params.status as TaskStatus, card.params.reason);
            return card.type === "REPORT_BLOCKER" ? "Blocker reported." : "Status updated.";
          }
          case "ASSIGN_TASK": {
            const { task } = await getTaskForEdit(card.targetId);
            await assignTask(task, card.params.assigneeId);
            return "Task reassigned.";
          }
          case "CHANGE_DUE_DATE": {
            const { task, dependsOn } = await getTaskForEdit(card.targetId);
            await updateTask(task, { ...taskToInput(task), dueDate: card.params.dueDate }, dependsOn);
            return "Due date changed.";
          }
        }
      } catch (err) {
        throw new Error(describeApiError(err));
      }
    },
    [navigate],
  );
}

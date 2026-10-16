import { useEffect, useMemo, useState } from "react";
import { useLocation } from "react-router-dom";
import type { PageContext } from "../services/assistantService";
import { getTask } from "../services/taskService";
import { useProjects } from "./useProjects";

/**
 * The page the user is on, sent with each message (route, project, task) and shown as
 * "Context: …". The server re-checks access to whatever it points at.
 */
export function useAssistantContext(): { pageContext: PageContext; label: string | null } {
  const { pathname, search } = useLocation();
  const { projects } = useProjects();
  const projectMatch = /^\/projects\/([^/]+)/.exec(pathname)?.[1];
  const projectId = projectMatch && projectMatch !== "new" ? decodeURIComponent(projectMatch) : undefined;
  const taskId = new URLSearchParams(search).get("task") ?? undefined;
  const [task, setTask] = useState<{ id: string; title: string } | null>(null);

  useEffect(() => {
    if (!taskId) return;
    let cancelled = false;
    getTask(taskId)
      .then((t) => !cancelled && setTask(t ? { id: t.id, title: t.title } : null))
      .catch(() => !cancelled && setTask(null));
    return () => {
      cancelled = true;
    };
  }, [taskId]);

  const projectName = projects.find((p) => p.id === projectId)?.name;
  const taskTitle = task && task.id === taskId ? task.title : undefined;
  const pageContext = useMemo<PageContext>(() => ({ route: pathname, projectId, taskId }), [pathname, projectId, taskId]);
  const label = [projectName, taskTitle].filter(Boolean).join(" / ") || null;
  return { pageContext, label };
}

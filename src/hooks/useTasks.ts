import { useCallback, useEffect, useMemo, useState } from "react";
import { observeEntityEvents, observeEventsByType } from "../services/auditService";
import type { Dependency, Task, TaskEvent, TaskStatus } from "../services/client";
import { observeDependencies } from "../services/dependencyService";
import { assignTask, cancelTask, changeTaskStatus, createTask, observeProjectTasks, observeTasks, updateTask } from "../services/taskService";
import type { TaskInput } from "../services/taskService";
import { describeApiError } from "../utils/apiErrors";
import { latestStatusEvents } from "../utils/taskRules";
import { useMyTeamMemberIds } from "./useTeam";

/** Live list of all readable tasks. `loading` is true until the first snapshot arrives. */
export function useTasks() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(
    () =>
      observeTasks(
        (items) => {
          setTasks(items);
          setLoading(false);
        },
        (err) => {
          console.error("[useTasks] Subscription failed", err);
          setError(true);
          setLoading(false);
        },
      ),
    [],
  );

  return { tasks, loading, error };
}

export type TaskPatcher = (task: Task | null, id: string) => void;

/**
 * Overlays local patches (optimistic moves, saved results) on live server tasks. A patch wins only
 * while it is newer than the server copy, so a moved task never jumps back while the server catches up.
 */
function usePatchedTasks(serverTasks: Task[]) {
  const [patches, setPatches] = useState<ReadonlyMap<string, Task>>(new Map());

  const tasks = useMemo(
    () =>
      serverTasks.map((t) => {
        const patch = patches.get(t.id);
        return patch && patch.updatedAt > t.updatedAt ? patch : t;
      }),
    [serverTasks, patches],
  );

  const patch = useCallback<TaskPatcher>((task, id) => {
    setPatches((current) => {
      const next = new Map(current);
      if (task) next.set(id, task);
      else next.delete(id);
      return next;
    });
  }, []);

  return { tasks, patch };
}

/** Live list of every dependency link. */
function useAllDependencies() {
  const [dependencies, setDependencies] = useState<Dependency[]>([]);
  useEffect(
    () => observeDependencies(setDependencies, (err) => console.error("[useAllDependencies] Subscription failed", err)),
    [],
  );
  return dependencies;
}

/**
 * One project's tasks and dependencies, live.
 * Local patches (optimistic moves, saved results) are shown until the subscription delivers a
 * version at least as recent — so a dragged card never jumps back while the server catches up.
 */
export function useProjectBoard(projectId: string | undefined) {
  const [serverTasks, setServerTasks] = useState<Task[]>([]);
  const [loadedFor, setLoadedFor] = useState<string | null>(null);
  const { tasks, patch } = usePatchedTasks(serverTasks);
  const allDependencies = useAllDependencies();

  useEffect(() => {
    if (!projectId) return;
    return observeProjectTasks(
      projectId,
      (items) => {
        setServerTasks(items);
        setLoadedFor(projectId);
      },
      (err) => {
        console.error("[useProjectBoard] Task subscription failed", err);
        setLoadedFor(projectId);
      },
    );
  }, [projectId]);

  const taskIds = useMemo(() => new Set(tasks.map((t) => t.id)), [tasks]);
  const dependencies = useMemo(
    () => allDependencies.filter((d) => taskIds.has(d.fromTaskId) || taskIds.has(d.toTaskId)),
    [allDependencies, taskIds],
  );
  const tasksById = useMemo(() => new Map(tasks.map((t) => [t.id, t])), [tasks]);

  const loading = !!projectId && loadedFor !== projectId;
  return { tasks, tasksById, dependencies, loading, patch };
}

/**
 * Every readable task (live, with optimistic patches), plus the ones assigned to the signed-in
 * user (TeamMember email match) and every dependency — for "My tasks" and the workload page.
 */
export function useAllTasksBoard() {
  const { tasks: serverTasks, loading: tasksLoading } = useTasks();
  const { tasks, patch } = usePatchedTasks(serverTasks);
  const dependencies = useAllDependencies();
  const { ids: myMemberIds, loading: membersLoading } = useMyTeamMemberIds();

  const tasksById = useMemo(() => new Map(tasks.map((t) => [t.id, t])), [tasks]);
  const myTasks = useMemo(() => {
    const mine = new Set(myMemberIds);
    return tasks.filter((t) => !!t.assigneeId && mine.has(t.assigneeId));
  }, [tasks, myMemberIds]);

  return { tasks, myTasks, myMemberIds, tasksById, dependencies, loading: tasksLoading || membersLoading, patch };
}

/** Latest STATUS_CHANGED event per task (live): blocker reasons and completion dates come from it. */
export function useStatusEvents() {
  const [events, setEvents] = useState<TaskEvent[]>([]);
  useEffect(
    () => observeEventsByType("STATUS_CHANGED", setEvents, (err) => console.error("[useStatusEvents] Subscription failed", err)),
    [],
  );
  return useMemo(() => latestStatusEvents(events), [events]);
}

/** Task writes (create / edit / move / cancel / reassign) with user-facing errors. */
export function useTaskActions(patch: TaskPatcher) {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const guard = useCallback(async <T,>(action: () => Promise<T>): Promise<T | null> => {
    setSubmitting(true);
    setError(null);
    try {
      return await action();
    } catch (err) {
      console.error("[useTaskActions] Action failed", err);
      setError(describeApiError(err));
      return null;
    } finally {
      setSubmitting(false);
    }
  }, []);

  /** Create with its dependency links (one server call: rules, links and audit together). */
  const create = useCallback(
    (input: TaskInput, dependsOn: readonly string[]) => guard(() => createTask(input, dependsOn)),
    [guard],
  );

  /** Update fields and replace the dependency links. */
  const update = useCallback(
    (before: Task, input: TaskInput, dependsOn: readonly string[]) =>
      guard(async () => {
        const task = await updateTask(before, input, dependsOn);
        patch(task, task.id);
        return task;
      }),
    [guard, patch],
  );

  /** Optimistic status change; rolls back if the server refuses it. `reason`: blocker reports. */
  const move = useCallback(
    async (task: Task, status: TaskStatus, reason?: string) => {
      patch({ ...task, status, updatedAt: new Date().toISOString() }, task.id);
      const saved = await guard(() => changeTaskStatus(task, status, reason));
      patch(saved, task.id); // server version, or remove the optimistic patch on failure
      return saved !== null;
    },
    [guard, patch],
  );

  /** Optimistic reassignment. */
  const reassign = useCallback(
    async (task: Task, assigneeId: string) => {
      patch({ ...task, assigneeId, updatedAt: new Date().toISOString() }, task.id);
      const saved = await guard(() => assignTask(task, assigneeId));
      patch(saved, task.id);
      return saved !== null;
    },
    [guard, patch],
  );

  /** Cancel (status CANCELLED, never deleted). */
  const cancel = useCallback(
    async (task: Task) => {
      patch({ ...task, status: "CANCELLED", updatedAt: new Date().toISOString() }, task.id);
      const saved = await guard(() => cancelTask(task));
      patch(saved, task.id);
      return saved !== null;
    },
    [guard, patch],
  );

  const clearError = useCallback(() => setError(null), []);
  return { create, update, move, reassign, cancel, submitting, error, setError, clearError };
}

/** Live audit history of one task, newest first. */
export function useTaskHistory(taskId: string | null) {
  const [events, setEvents] = useState<TaskEvent[]>([]);
  const [loadedFor, setLoadedFor] = useState<string | null>(null);

  useEffect(() => {
    if (!taskId) return;
    return observeEntityEvents(
      taskId,
      (items) => {
        setEvents(items);
        setLoadedFor(taskId);
      },
      (err) => {
        console.error("[useTaskHistory] Subscription failed", err);
        setLoadedFor(taskId);
      },
    );
  }, [taskId]);

  const sorted = useMemo(() => [...events].sort((a, b) => b.createdAt.localeCompare(a.createdAt)), [events]);
  return { events: taskId && loadedFor === taskId ? sorted : [], loading: !!taskId && loadedFor !== taskId };
}

import { useCallback, useEffect, useMemo, useState } from "react";
import type { Milestone, Project } from "../services/client";
import { createMilestone, observeMilestones } from "../services/milestoneService";
import { getProject, updateProject } from "../services/projectService";
import type { ProjectChanges } from "../services/projectService";
import { describeApiError } from "../utils/apiErrors";
import { useUser } from "./useUser";

interface LoadResult {
  id: string;
  project: Project | null;
}

/** One project by id. `project` is null when not found or not readable. `replace` applies a saved version. */
export function useProject(id: string | undefined) {
  const [result, setResult] = useState<LoadResult | null>(null);

  useEffect(() => {
    if (!id) return;
    let active = true;
    getProject(id)
      .catch((err: unknown) => {
        console.error("[useProject] Load failed", err);
        return null;
      })
      .then((project) => {
        if (active) setResult({ id, project });
      });
    return () => {
      active = false;
    };
  }, [id]);

  const replace = useCallback((project: Project) => setResult({ id: project.id, project }), []);

  // Loading until the result for the *current* id has arrived (handles id changes).
  const loading = !!id && result?.id !== id;
  return { project: loading ? null : (result?.project ?? null), loading, replace };
}

/** Edit status / dates / objective (managers). */
export function useProjectActions() {
  const { email } = useUser();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const update = useCallback(
    async (project: Project, changes: ProjectChanges): Promise<Project | null> => {
      setSubmitting(true);
      setError(null);
      try {
        return await updateProject(project, changes, { email });
      } catch (err) {
        console.error("[useProjectActions] Update failed", err);
        setError(describeApiError(err));
        return null;
      } finally {
        setSubmitting(false);
      }
    },
    [email],
  );

  const clearError = useCallback(() => setError(null), []);
  return { update, submitting, error, clearError };
}

/** Live milestones of a project (sorted by due date) and a create action. */
export function useMilestones(projectId: string | undefined) {
  const { email } = useUser();
  const [milestones, setMilestones] = useState<Milestone[]>([]);
  const [loadedFor, setLoadedFor] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!projectId) return;
    return observeMilestones(
      projectId,
      (items) => {
        setMilestones(items);
        setLoadedFor(projectId);
      },
      (err) => {
        console.error("[useMilestones] Subscription failed", err);
        setLoadedFor(projectId);
      },
    );
  }, [projectId]);

  const create = useCallback(
    async (name: string, dueDate: string): Promise<boolean> => {
      if (!projectId) return false;
      setSubmitting(true);
      setError(null);
      try {
        await createMilestone({ projectId, name, dueDate }, { email });
        return true;
      } catch (err) {
        console.error("[useMilestones] Creation failed", err);
        setError(describeApiError(err));
        return false;
      } finally {
        setSubmitting(false);
      }
    },
    [projectId, email],
  );

  const sorted = useMemo(
    () => [...milestones].sort((a, b) => (a.dueDate ?? "9999-12-31").localeCompare(b.dueDate ?? "9999-12-31")),
    [milestones],
  );
  return { milestones: sorted, loading: !!projectId && loadedFor !== projectId, create, submitting, error };
}


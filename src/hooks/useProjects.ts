import { useEffect, useState } from "react";
import type { Project } from "../services/client";
import { observeProjects } from "../services/projectService";

/** Live project list (Project.observeQuery). `loading` is true until the first snapshot arrives. */
export function useProjects() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(
    () =>
      observeProjects(
        (items) => {
          setProjects(items);
          setLoading(false);
        },
        (err) => {
          console.error("[useProjects] Subscription failed", err);
          setError(true);
          setLoading(false);
        },
      ),
    [],
  );

  return { projects, loading, error };
}

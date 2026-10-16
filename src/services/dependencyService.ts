import { client } from "./client";
import type { Dependency } from "./client";

/**
 * Live list of dependencies (read-only: links are written by the task functions). Dependency has no projectId, so callers filter to their
 * project's task ids. Returns an unsubscribe function.
 */
export function observeDependencies(onChange: (deps: Dependency[]) => void, onError: (err: unknown) => void): () => void {
  const subscription = client.models.Dependency.observeQuery().subscribe({
    next: ({ items }) => onChange([...items]),
    error: onError,
  });
  return () => subscription.unsubscribe();
}

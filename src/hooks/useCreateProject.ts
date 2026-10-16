import { useCallback, useState } from "react";
import type { Project } from "../services/client";
import { createProject } from "../services/projectService";
import type { NewProjectInput } from "../services/projectService";
import { describeApiError } from "../utils/apiErrors";
import { useUser } from "./useUser";

export type ProjectFormValues = Omit<NewProjectInput, "organisationId">;

/** Creates a project in the user's organisation (audit event included). Errors are user-facing messages. */
export function useCreateProject() {
  const { email, organisationId } = useUser();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /** Resolves to the created project, or null on failure (see `error`). */
  const create = useCallback(
    async (values: ProjectFormValues): Promise<Project | null> => {
      if (!organisationId) {
        setError("No organisation is set up yet. Contact your administrator.");
        return null;
      }
      setSubmitting(true);
      setError(null);
      try {
        return await createProject({ ...values, organisationId }, { email });
      } catch (err) {
        console.error("[useCreateProject] Creation failed", err);
        setError(describeApiError(err));
        return null;
      } finally {
        setSubmitting(false);
      }
    },
    [organisationId, email],
  );

  return { create, submitting, error };
}

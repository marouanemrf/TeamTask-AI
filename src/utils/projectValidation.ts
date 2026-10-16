import type { ProjectFormValues } from "../hooks/useCreateProject";

export type ProjectFormErrors = Partial<Record<"name" | "endDate" | "managerEmail", string>>;

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/** Client-side checks for the project form. Dates are YYYY-MM-DD, so string comparison is chronological. */
export function validateProjectForm(values: ProjectFormValues): ProjectFormErrors {
  const errors: ProjectFormErrors = {};
  if (!values.name.trim()) errors.name = "Project name is required.";
  if (values.startDate && values.endDate && values.endDate <= values.startDate) {
    errors.endDate = "End date must be after the start date.";
  }
  if (values.managerEmail && !EMAIL_PATTERN.test(values.managerEmail.trim())) {
    errors.managerEmail = "Enter a valid email address.";
  }
  return errors;
}

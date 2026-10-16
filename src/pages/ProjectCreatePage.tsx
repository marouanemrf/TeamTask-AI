import { Link, useNavigate } from "react-router-dom";
import ProjectForm from "../components/projects/ProjectForm";
import { useCreateProject } from "../hooks/useCreateProject";
import type { ProjectFormValues } from "../hooks/useCreateProject";
import { useUser } from "../hooks/useUser";
import { ROUTES, projectPath } from "../utils/routes";

/** Managers only. On success the project (and its CREATED audit event) exist; go to its page. */
function ProjectCreatePage() {
  const navigate = useNavigate();
  const { email, isManager, organisationStatus } = useUser();
  const { create, submitting, error } = useCreateProject();

  if (organisationStatus === "loading") {
    return <p className="empty-state panel">Loading…</p>;
  }

  if (!isManager) {
    return (
      <div className="panel">
        <p>Only administrators and project managers can create projects.</p>
        <p className="panel__footer">
          <Link className="text-link" to={ROUTES.projects}>
            Back to projects
          </Link>
        </p>
      </div>
    );
  }

  async function handleSubmit(values: ProjectFormValues) {
    const project = await create(values);
    if (project) navigate(projectPath(project.id));
  }

  return (
    <ProjectForm
      defaultManagerEmail={email ?? ""}
      submitting={submitting}
      error={error}
      onSubmit={(values) => void handleSubmit(values)}
      onCancel={() => navigate(ROUTES.projects)}
    />
  );
}

export default ProjectCreatePage;

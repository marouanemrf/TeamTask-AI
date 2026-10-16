import { useMemo } from "react";
import CvBuilder from "../components/team/CvBuilder";
import ProfileForm from "../components/team/ProfileForm";
import { usePresence } from "../hooks/usePresence";
import { useMyProfile } from "../hooks/useProfile";
import { useProjects } from "../hooks/useProjects";
import { useTasks } from "../hooks/useTasks";
import { suggestCareers } from "../utils/careerSuggestions";

/** Self-service profile: edit the professional profile; the CV section includes the career suggestions. */
export default function ProfilePage() {
  const profile = useMyProfile();
  const { projects } = useProjects();
  const { tasks } = useTasks();
  const { ownStatus, setOwnStatus } = usePresence();
  const { member } = profile;

  // Projects the member has tasks in.
  const relatedProjects = useMemo(() => {
    if (!member) return [];
    const ids = new Set(tasks.filter((t) => t.assigneeId === member.id).map((t) => t.projectId));
    return projects.filter((p) => ids.has(p.id));
  }, [member, tasks, projects]);

  const suggestions = useMemo(
    () =>
      member
        ? suggestCareers({
            skills: (member.skills ?? []).filter((s): s is string => !!s),
            jobTitle: member.jobTitle,
            experience: member.experience,
            education: member.education,
            projects: relatedProjects.map((p) => [p.name, p.objective].filter(Boolean).join(" ")),
          })
        : [],
    [member, relatedProjects],
  );

  if (profile.loading) return <p className="empty-state panel">Loading your profile…</p>;
  if (!member) {
    return <p className="empty-state panel">Your team profile isn't available yet. Ask an administrator to add your account to the team.</p>;
  }

  return (
    <div className="page-stack profile-page">
      <ProfileForm
        key={`${member.id}:${member.updatedAt}`}
        member={member}
        email={profile.email}
        saving={profile.saving}
        uploading={profile.uploading}
        error={profile.error}
        ownStatus={ownStatus}
        onStatusChange={setOwnStatus}
        onUploadPhoto={profile.uploadPhoto}
        onSave={profile.save}
      />
      <CvBuilder member={member} email={profile.email} projects={relatedProjects} suggestions={suggestions} />
    </div>
  );
}

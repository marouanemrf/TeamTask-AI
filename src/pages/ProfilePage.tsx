import { useMemo } from "react";
import CvBuilder from "../components/team/CvBuilder";
import ProfileForm from "../components/team/ProfileForm";
import { usePresence } from "../hooks/usePresence";
import { useMyProfile } from "../hooks/useProfile";
import { useProjects } from "../hooks/useProjects";
import { useTasks } from "../hooks/useTasks";
import { useUser } from "../hooks/useUser";
import type { TeamMember } from "../services/client";
import { useCareerSuggestions } from "../hooks/useCareerSuggestions";
import { canUseAssistant } from "../utils/roles";
import LoadingState from "../components/ui/LoadingState";

/** Self-service profile: edit the professional profile; the CV section (with the career suggestions) from Member up. */
export default function ProfilePage() {
  const profile = useMyProfile();
  const { projects } = useProjects();
  const { tasks } = useTasks();
  const { ownStatus, setOwnStatus } = usePresence();
  const { isAdmin, roles } = useUser();
  // CV and AI career ideas start at Member: a viewer only reads (use case diagram).
  const withCv = canUseAssistant(roles);
  const { member } = profile;

  // Projects the member has tasks in.
  const relatedProjects = useMemo(() => {
    if (!member) return [];
    const ids = new Set(tasks.filter((t) => t.assigneeId === member.id).map((t) => t.projectId));
    return projects.filter((p) => ids.has(p.id));
  }, [member, tasks, projects]);

  // AI suggestions from the saved profile; refreshed whenever the profile is saved (updatedAt).
  const career = useCareerSuggestions(withCv ? member : undefined);

  if (profile.loading) return <LoadingState className="empty-state panel">Loading your profile…</LoadingState>;
  if (!member) {
    if (!isAdmin || !profile.email) {
      return <p className="empty-state panel">Your team profile isn't available yet. Ask an administrator to add your account to the team.</p>;
    }
    // An administrator whose account was created directly in Cognito (e.g. the first one of a new
    // deployment) creates their own team profile here; the server adds it to the organisation.
    const draft = { id: "", email: profile.email, name: profile.email.split("@")[0], skills: [], jobTitle: null, avatarKey: null, updatedAt: "" } as unknown as TeamMember;
    return (
      <div className="page-stack profile-page">
        <p className="notice panel">You don't have a team profile yet. Fill it in and save to create it.</p>
        <ProfileForm
          key="new-admin-profile"
          member={draft}
          email={profile.email}
          saving={profile.saving}
          uploading={profile.uploading}
          error={profile.error}
          ownStatus={ownStatus}
          onStatusChange={setOwnStatus}
          onUploadPhoto={profile.uploadPhoto}
          onSave={profile.save}
          canEditJobTitle
        />
      </div>
    );
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
        canEditJobTitle={isAdmin}
      />
      {withCv && <CvBuilder member={member} email={profile.email} projects={relatedProjects} career={career.state} onRefreshCareer={career.refresh} />}
    </div>
  );
}

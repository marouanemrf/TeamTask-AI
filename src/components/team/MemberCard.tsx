import { Link } from "react-router-dom";
import type { TeamMember } from "../../services/client";
import { memberPath } from "../../utils/routes";
import MemberAvatar from "./MemberAvatar";
import RoleBadge from "./RoleBadge";
import SkillChips from "./SkillChips";
import PresenceDot from "./PresenceDot";

export interface MemberCardProps {
  member: TeamMember;
  openTaskCount: number;
}

/** Whole card is one link to the member page (single tab stop). */
function MemberCard({ member, openTaskCount }: MemberCardProps) {
  return (
    <Link className="member-card" to={memberPath(member.id)}>
      <div className="member-card__header">
        <span className="avatar-presence"><MemberAvatar name={member.name} avatarKey={member.avatarKey} /><PresenceDot email={member.email}/></span>
        <span className="member-card__identity">
          <span className="member-card__name">{member.name}</span>
          {member.username && <span className="member-card__username">@{member.username}</span>}
          <span className="member-card__job">{member.jobTitle || "No job title"}</span>
        </span>
        <RoleBadge role={member.role} roles={member.roles} />
      </div>

      <SkillChips skills={member.skills ?? []} max={4} />

      <dl className="member-card__stats">
        <div>
          <dt>Capacity</dt>
          <dd>{member.weeklyCapacityHours ?? 0} h / week</dd>
        </div>
        <div>
          <dt>Open tasks</dt>
          <dd>{openTaskCount}</dd>
        </div>
      </dl>
    </Link>
  );
}

export default MemberCard;

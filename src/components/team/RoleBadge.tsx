import type { TeamRole } from "../../services/client";
import { ROLE_LABELS } from "../../utils/roles";

const ROLE_CLASS: Record<TeamRole, string> = {
  ADMIN: "badge--purple",
  PROJECT_MANAGER: "badge--teal",
  MEMBER: "badge--blue",
  VIEWER: "badge--gray",
};

/** Role pill: ADMIN purple, PROJECT_MANAGER teal, MEMBER blue, VIEWER gray (label always shown). */
function RoleBadge({ role, roles }: { role?: TeamRole | null; roles?: readonly (string | null)[] | null }) {
  const values = roles?.filter((value): value is TeamRole => !!value && value in ROLE_CLASS);
  const visible = values?.length ? values : [role ?? "VIEWER"];
  return <span className="role-badges">{visible.map((value) => <span key={value} className={`badge ${ROLE_CLASS[value]}`}>{ROLE_LABELS[value]}</span>)}</span>;
}

export default RoleBadge;

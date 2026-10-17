import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { Link, Outlet, useLocation } from "react-router-dom";
import { useTeamMembers } from "../../hooks/useTeam";
import { useUser } from "../../hooks/useUser";
import { normalizeEmail } from "../../utils/text";
import { ROUTES, pageTitle } from "../../utils/routes";
import AssistantWidget from "../agent/AssistantWidget";
import MemberAvatar from "../team/MemberAvatar";
import PresenceDot from "../team/PresenceDot";
import { ChartIcon, ChatIcon, CloseIcon, DashboardIcon, FlagIcon, FolderIcon, MenuIcon, ProfileIcon, ShieldIcon, SignOutIcon, TasksIcon, TeamIcon } from "../ui/Icons";
import ThemeToggle from "../ui/ThemeToggle";

interface NavItem {
  to: string;
  label: string;
  icon: ReactNode;
  /** Which URLs highlight this entry ("/team/workload" must not also highlight "Team"). */
  isActive: (pathname: string) => boolean;
  managersOnly?: boolean;
}

const NAV_ITEMS: readonly NavItem[] = [
  { to: ROUTES.dashboard, label: "Dashboard", icon: <DashboardIcon />, isActive: (p) => p === "/" },
  { to: ROUTES.projects, label: "Projects", icon: <FolderIcon />, isActive: (p) => p.startsWith(ROUTES.projects) },
  { to: ROUTES.myTasks, label: "My tasks", icon: <TasksIcon />, isActive: (p) => p.startsWith(ROUTES.myTasks) },
  { to: ROUTES.team, label: "Team", icon: <TeamIcon />, isActive: (p) => p.startsWith(ROUTES.team) && !p.startsWith(ROUTES.workload) },
  { to: ROUTES.workload, label: "Team workload", icon: <ChartIcon />, isActive: (p) => p.startsWith(ROUTES.workload), managersOnly: true },
  { to: ROUTES.escalations, label: "Open escalations", icon: <ShieldIcon />, isActive: (p) => p.startsWith(ROUTES.escalations), managersOnly: true },
  { to: ROUTES.agentActivity, label: "Agent activity", icon: <ChatIcon />, isActive: (p) => p.startsWith(ROUTES.agentActivity) },
  { to: ROUTES.pilot, label: "Pilot metrics", icon: <FlagIcon />, isActive: (p) => p.startsWith(ROUTES.pilot), managersOnly: true },
];

/** Authenticated shell: sidebar navigation (off-canvas below 768px), top bar, page outlet. */
function AppLayout() {
  const { email, isManager, organisationStatus, signOut } = useUser();
  const { members } = useTeamMembers();
  // The signed-in user's team profile (for the top bar picture), matched by email.
  const me = email ? members.find((m) => normalizeEmail(m.email) === normalizeEmail(email)) : undefined;
  const { pathname } = useLocation();
  const title = pageTitle(pathname);
  const profileActive = pathname.startsWith(ROUTES.profile);
  const [navOpen, setNavOpen] = useState(false);

  useEffect(() => {
    document.title = `${title} · TeamTask AI`;
  }, [title]);

  // Escape closes the mobile menu.
  useEffect(() => {
    if (!navOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setNavOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [navOpen]);

  return (
    <div className="app-layout">
      <a className="skip-link" href="#main-content">
        Skip to content
      </a>

      {/* Sidebar */}
      <aside id="app-sidebar" className={`sidebar${navOpen ? " sidebar--open" : ""}`} aria-label="Main navigation">
        <div className="sidebar__brand">
          <span className="sidebar__logo">
            <ShieldIcon />
          </span>
          <span>
            <span className="sidebar__name">Gogo Security</span>
            <span className="sidebar__subtitle">TeamTask AI</span>
          </span>
          <button
            type="button"
            className="icon-button sidebar__close"
            onClick={() => setNavOpen(false)}
            aria-label="Close menu"
          >
            <CloseIcon />
          </button>
        </div>
        <nav>
          <ul className="sidebar__nav">
            {NAV_ITEMS.filter((item) => !item.managersOnly || isManager).map((item) => {
              const active = item.isActive(pathname);
              return (
                <li key={item.to}>
                  <Link
                    to={item.to}
                    className={`sidebar__link${active ? " sidebar__link--active" : ""}`}
                    aria-current={active ? "page" : undefined}
                    onClick={() => setNavOpen(false)}
                  >
                    {item.icon}
                    <span>{item.label}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>
        <div className="sidebar__footer">
          <ThemeToggle />
          {/* Profile sits just above Sign out; the user's picture replaces the icon when one is set. */}
          <Link
            to={ROUTES.profile}
            className={`sidebar__link${profileActive ? " sidebar__link--active" : ""}`}
            aria-current={profileActive ? "page" : undefined}
            onClick={() => setNavOpen(false)}
          >
            {me?.avatarKey ? (
              <span className="sidebar__avatar"><MemberAvatar name={me.name} avatarKey={me.avatarKey} size="sm" /></span>
            ) : (
              <ProfileIcon />
            )}
            <span>My profile</span>
          </Link>
          <button type="button" className="sidebar__link sidebar__signout" onClick={() => void signOut()}><SignOutIcon/><span>Sign out</span></button>
        </div>
      </aside>
      {navOpen && <div className="sidebar-backdrop" onClick={() => setNavOpen(false)} aria-hidden="true" />}

      {/* Main column */}
      <div className="app-main">
        <header className="topbar">
          <button
            type="button"
            className="icon-button topbar__menu"
            onClick={() => setNavOpen(true)}
            aria-label="Open menu"
            aria-expanded={navOpen}
            aria-controls="app-sidebar"
          >
            <MenuIcon />
          </button>
          <h1 className="topbar__title">{title}</h1>
          <div className="topbar__user">
            {/* Only the user's picture and presence; falls back to email initials before a team profile exists. */}
            {email && (
              <Link className="topbar__profile" to={ROUTES.profile} aria-label="Open my profile">
                <MemberAvatar name={me?.name ?? email.split("@")[0]} avatarKey={me?.avatarKey} size="sm" />
                <PresenceDot email={email} className="topbar__presence" />
              </Link>
            )}
          </div>
        </header>

        <main id="main-content" className="page" tabIndex={-1}>
          {organisationStatus === "missing" && (
            <div className="form-alert page__alert" role="alert">
              <span>No organisation is set up yet. Contact your administrator.</span>
            </div>
          )}
          <Outlet />
        </main>
      </div>
      {/* The TeamTask assistant, for every role (permissions are applied by the server tools). */}
      <AssistantWidget />
    </div>
  );
}

export default AppLayout;

import type { ReactNode } from "react";

/** Decorative stroke icons (24×24 grid); hidden from assistive technology. */
function Icon({ children }: { children: ReactNode }) {
  return (
    <svg
      className="icon"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

export function DashboardIcon() {
  return (
    <Icon>
      <rect x="3" y="3" width="7" height="9" rx="1.5" />
      <rect x="14" y="3" width="7" height="5" rx="1.5" />
      <rect x="14" y="12" width="7" height="9" rx="1.5" />
      <rect x="3" y="16" width="7" height="5" rx="1.5" />
    </Icon>
  );
}

export function FolderIcon() {
  return (
    <Icon>
      <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z" />
    </Icon>
  );
}

export function TasksIcon() {
  return (
    <Icon>
      <path d="m4 7 2 2 4-4" />
      <path d="M13 7h7" />
      <path d="m4 16 2 2 4-4" />
      <path d="M13 16h7" />
    </Icon>
  );
}

export function TeamIcon() {
  return (
    <Icon>
      <circle cx="9" cy="8" r="3.5" />
      <path d="M2.5 20a6.5 6.5 0 0 1 13 0" />
      <path d="M16 4.5a3.5 3.5 0 0 1 0 7" />
      <path d="M18 14.5a6.5 6.5 0 0 1 3.5 5.5" />
    </Icon>
  );
}

export function SignOutIcon() {
  return <Icon><path d="M10 17l5-5-5-5M15 12H3"/><path d="M12 3h6a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-6"/></Icon>;
}
export function ProfileIcon() {
  return <Icon><circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/></Icon>;
}

export function MenuIcon() {
  return (
    <Icon>
      <path d="M4 6h16M4 12h16M4 18h16" />
    </Icon>
  );
}

export function CloseIcon() {
  return (
    <Icon>
      <path d="M6 6l12 12M18 6 6 18" />
    </Icon>
  );
}

export function PlusIcon() {
  return (
    <Icon>
      <path d="M12 5v14M5 12h14" />
    </Icon>
  );
}

export function SearchIcon() {
  return (
    <Icon>
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.5-3.5" />
    </Icon>
  );
}

export function ShieldIcon() {
  return (
    <Icon>
      <path d="M12 2.5 19.5 5v6.2c0 4.6-3.1 8.4-7.5 10.3-4.4-1.9-7.5-5.7-7.5-10.3V5Z" />
      <path d="M9.5 11.5V10a2.5 2.5 0 0 1 5 0v1.5" />
      <rect x="8.5" y="11.5" width="7" height="5" rx="1" />
    </Icon>
  );
}

export function LockIcon() {
  return (
    <Icon>
      <rect x="5" y="11" width="14" height="9" rx="2" />
      <path d="M8 11V8a4 4 0 0 1 8 0v3" />
    </Icon>
  );
}

export function ChevronDownIcon() {
  return (
    <Icon>
      <path d="m6 9 6 6 6-6" />
    </Icon>
  );
}

export function EditIcon() {
  return (
    <Icon>
      <path d="M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16Z" />
    </Icon>
  );
}

export function ChartIcon() {
  return (
    <Icon>
      <path d="M4 20V10M10 20V4M16 20v-7M22 20H2" />
    </Icon>
  );
}

export function FlagIcon() {
  return (
    <Icon>
      <path d="M5 21V4h11l-1.5 4L16 12H5" />
    </Icon>
  );
}

export function ChatIcon() {
  return (
    <Icon>
      <path d="M5 5h14a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H10l-4 3v-3H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1Z" />
      <path d="M8.5 10.5h.01M12 10.5h.01M15.5 10.5h.01" />
    </Icon>
  );
}

export function SendIcon() {
  return (
    <Icon>
      <path d="m4 12 16-8-6 16-2.5-6.5L4 12Z" />
    </Icon>
  );
}

export function StopIcon() {
  return (
    <Icon>
      <rect x="7" y="7" width="10" height="10" rx="1.5" />
    </Icon>
  );
}

export function RefreshIcon() {
  return (
    <Icon>
      <path d="M20 11a8 8 0 1 0-2.3 5.7M20 5v6h-6" />
    </Icon>
  );
}

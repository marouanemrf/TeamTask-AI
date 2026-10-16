import { Link } from "react-router-dom";

export interface StatCardProps {
  label: string;
  value: string;
  hint?: string;
  tone?: "default" | "alert";
  /** When set, the whole card links there. */
  to?: string;
  /** Accessible description of the link target (e.g. "See my tasks"). */
  linkLabel?: string;
}

function StatCard({ label, value, hint, tone = "default", to, linkLabel }: StatCardProps) {
  const className = `stat-card${tone === "alert" ? " stat-card--alert" : ""}${to ? " stat-card--link" : ""}`;
  const content = (
    <>
      <span className="stat-card__label">{label}</span>
      <span className="stat-card__value">{value}</span>
      {hint && <span className="stat-card__hint">{hint}</span>}
      {to && linkLabel && <span className="visually-hidden"> — {linkLabel}</span>}
    </>
  );
  return to ? (
    <Link className={className} to={to}>
      {content}
    </Link>
  ) : (
    <div className={className}>{content}</div>
  );
}

export default StatCard;

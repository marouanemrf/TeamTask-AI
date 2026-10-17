import { Link } from "react-router-dom";
import CountUp from "../reactbits/CountUp";

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

/** "12", "25%", "1.5 h", "3 / 4" → the leading number counts up; the rest stays as written. */
const NUMBER = /^(\d+(?:\.\d+)?)(.*)$/;

function StatValue({ value }: { value: string }) {
  // "—" is what pages show while loading: a skeleton bar instead of a dash.
  if (value === "—") return <span className="skeleton skeleton--value" role="status" aria-label="Loading" />;
  const match = NUMBER.exec(value);
  if (!match) return <>{value}</>;
  return (
    <>
      <CountUp to={Number(match[1])} duration={0.9} />
      {match[2]}
    </>
  );
}

function StatCard({ label, value, hint, tone = "default", to, linkLabel }: StatCardProps) {
  const className = `stat-card${tone === "alert" ? " stat-card--alert" : ""}${to ? " stat-card--link" : ""}`;
  const content = (
    <>
      <span className="stat-card__label">{label}</span>
      <span className="stat-card__value">
        <StatValue value={value} />
      </span>
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

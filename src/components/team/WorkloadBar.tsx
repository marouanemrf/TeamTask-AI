import type { Workload } from "../../utils/workload";

const LEVEL_LABEL: Record<Workload["level"], string> = {
  ok: "Within capacity",
  high: "Near capacity",
  over: "Over capacity",
};

const formatHours = (hours: number) => `${Number.isInteger(hours) ? hours : hours.toFixed(1)} h`;

/** Open-task hours vs weekly capacity: green < 80%, amber 80–100%, red > 100%. */
function WorkloadBar({ workload }: { workload: Workload }) {
  const { hours, capacity, percent, level } = workload;
  return (
    <div className={`workload workload--${level}`}>
      <div className="workload__header">
        <span className="workload__value">
          {formatHours(hours)} / {formatHours(capacity)}
        </span>
        <span className="workload__level">
          {percent}% · {LEVEL_LABEL[level]}
        </span>
      </div>
      <div
        className="workload__track"
        role="progressbar"
        aria-label="Weekly workload"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.min(percent, 100)}
        aria-valuetext={`${percent}% of weekly capacity, ${LEVEL_LABEL[level].toLowerCase()}`}
      >
        <span className="workload__bar" style={{ width: `${Math.min(percent, 100)}%` }} />
      </div>
    </div>
  );
}

export default WorkloadBar;

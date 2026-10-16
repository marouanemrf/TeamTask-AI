/** Placeholder shown while data loads: a spinner first, then the label. */
function LoadingState({ children = "Loading…", className = "empty-state" }: { children?: string; className?: string }) {
  return (
    <p className={`${className} loading-state`} role="status">
      <span className="spinner loading-state__spinner" aria-hidden="true" />
      <span>{children}</span>
    </p>
  );
}

export default LoadingState;

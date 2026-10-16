export type AgentOrbState = "idle" | "thinking" | "error";

/**
 * Lightweight animated orb that shows what the assistant is doing (CSS only, decorative).
 * Phase 6 swaps it for the 3D AgentOrb3D; the `state` prop stays the same.
 */
function AgentOrb({ state = "idle", size = "md" }: { state?: AgentOrbState; size?: "sm" | "md" }) {
  return (
    <span className={`agent-orb agent-orb--${state} agent-orb--${size}`} aria-hidden="true">
      <span className="agent-orb__core" />
      <span className="agent-orb__ring" />
    </span>
  );
}

export default AgentOrb;

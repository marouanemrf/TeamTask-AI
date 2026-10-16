export type AgentOrbState = "idle" | "listening" | "thinking" | "proposing" | "error";

/**
 * Lightweight animated orb that shows what the assistant is doing (CSS only, decorative).
 * Fallback of AgentOrb3D when WebGL is unavailable; same `state` prop.
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

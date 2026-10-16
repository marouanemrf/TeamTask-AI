import { Component, lazy, Suspense, useState } from "react";
import type { ReactNode } from "react";
import AgentOrb from "./AgentOrb";
import type { AgentOrbState } from "./AgentOrb";

const AgentOrbScene = lazy(() => import("./AgentOrbScene"));

/** three.js needs WebGL 2; checked once so the 3D bundle is never downloaded needlessly. */
let webgl2: boolean | null = null;
function hasWebGL2(): boolean {
  if (webgl2 !== null) return webgl2;
  try {
    const gl = document.createElement("canvas").getContext("webgl2");
    gl?.getExtension("WEBGL_lose_context")?.loseContext();
    webgl2 = !!gl;
  } catch {
    webgl2 = false;
  }
  return webgl2;
}

class SceneBoundary extends Component<{ fallback: ReactNode; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

/**
 * The assistant's orb: a faceted 3D sphere with orbiting particles whose motion follows `state`
 * (idle, listening, thinking, proposing, error). Lazy-loaded; falls back to the CSS orb when WebGL
 * is unavailable, the context is lost or the scene fails. Decorative (aria-hidden).
 */
function AgentOrb3D({ state = "idle", size }: { state?: AgentOrbState; size: number }) {
  const [lost, setLost] = useState(false);
  const fallback = <AgentOrb state={state} size={size >= 56 ? "md" : "sm"} />;
  if (lost || !hasWebGL2()) return fallback;
  return (
    <span className="agent-orb-3d" style={{ width: size, height: size }} aria-hidden="true">
      <SceneBoundary fallback={fallback}>
        <Suspense fallback={fallback}>
          <AgentOrbScene state={state} onContextLost={() => setLost(true)} />
        </Suspense>
      </SceneBoundary>
    </span>
  );
}

export default AgentOrb3D;

import { useMemo, useRef, useSyncExternalStore } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { AdditiveBlending, Color, MathUtils } from "three";
import type { Group, Mesh, MeshStandardMaterial, Points } from "three";
import type { AgentOrbState } from "./AgentOrb";

const TEAL = new Color("#00E0B8");
const BLUE = new Color("#3B82F6");
const RED = new Color("#F05252");
const PARTICLES = 48;

/** Per state: rotation speed, pulse speed/amount, particle orbit radius, colour mix towards blue. */
const MOTION: Record<AgentOrbState, { spin: number; pulse: number; amp: number; radius: number; blue: number }> = {
  idle: { spin: 0.25, pulse: 1.2, amp: 0.03, radius: 1.55, blue: 0.15 },
  listening: { spin: 0.35, pulse: 4, amp: 0.07, radius: 1.5, blue: 0.25 },
  thinking: { spin: 1.6, pulse: 2.5, amp: 0.04, radius: 1.15, blue: 0.65 },
  proposing: { spin: 0.6, pulse: 1.5, amp: 0.03, radius: 1.45, blue: 0.4 },
  error: { spin: 0.2, pulse: 8, amp: 0.05, radius: 1.6, blue: 0 },
};

function Orb({ state, animate }: { state: AgentOrbState; animate: boolean }) {
  const core = useRef<Mesh>(null);
  const material = useRef<MeshStandardMaterial>(null);
  const cloud = useRef<Points>(null);
  const cubes = useRef<Group>(null);
  const radius = useRef(MOTION[state].radius);
  const seeds = useMemo(() => Array.from({ length: PARTICLES }, (_, i) => ({ phase: (i / PARTICLES) * Math.PI * 2, tilt: ((i * 7) % 11) / 11 - 0.5 })), []);
  const positions = useMemo(() => new Float32Array(PARTICLES * 3), []);

  useFrame(({ clock }, delta) => {
    const m = MOTION[state];
    const t = animate ? clock.getElapsedTime() : 0;
    radius.current = MathUtils.lerp(radius.current, m.radius, Math.min(1, delta * 3));
    if (core.current) {
      core.current.rotation.y += animate ? delta * m.spin : 0;
      core.current.rotation.x = 0.3;
      core.current.scale.setScalar(1 + Math.sin(t * m.pulse) * m.amp);
    }
    if (material.current) {
      const flicker = state === "error" && animate ? (Math.sin(t * 30) > 0 ? 1 : 0.4) : 1;
      const target = state === "error" ? RED : TEAL.clone().lerp(BLUE, m.blue + (state === "thinking" ? Math.sin(t * 2) * 0.2 : 0));
      material.current.color.lerp(target, Math.min(1, delta * 4));
      material.current.emissive.copy(material.current.color);
      material.current.emissiveIntensity = 0.55 * flicker;
    }
    // Particles orbit the core; "thinking" pulls them in. Hidden while "proposing" (cubes instead).
    seeds.forEach((s, i) => {
      const a = s.phase + t * (0.4 + m.spin * 0.3);
      positions[i * 3] = Math.cos(a) * radius.current;
      positions[i * 3 + 1] = Math.sin(a * 2) * 0.25 + s.tilt * 0.9;
      positions[i * 3 + 2] = Math.sin(a) * radius.current;
    });
    if (cloud.current) {
      cloud.current.geometry.attributes.position.needsUpdate = true;
      cloud.current.visible = state !== "proposing";
    }
    if (cubes.current) {
      cubes.current.visible = state === "proposing";
      cubes.current.rotation.y = t * 0.6;
    }
  });

  return (
    <>
      <mesh ref={core}>
        <icosahedronGeometry args={[1, 1]} />
        <meshStandardMaterial ref={material} color={TEAL} emissive={TEAL} emissiveIntensity={0.55} flatShading metalness={0.35} roughness={0.35} />
      </mesh>
      <points ref={cloud}>
        <bufferGeometry>
          <bufferAttribute attach="attributes-position" args={[positions, 3]} />
        </bufferGeometry>
        <pointsMaterial size={0.09} color={TEAL} transparent opacity={0.9} blending={AdditiveBlending} depthWrite={false} />
      </points>
      {/* "Proposing": particles gather into small cubes, one per proposed change. */}
      <group ref={cubes} visible={false}>
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <mesh key={i} position={[Math.cos((i / 6) * Math.PI * 2) * 1.5, (i % 2 ? 0.25 : -0.25), Math.sin((i / 6) * Math.PI * 2) * 1.5]}>
            <boxGeometry args={[0.22, 0.22, 0.22]} />
            <meshStandardMaterial color={BLUE} emissive={BLUE} emissiveIntensity={0.6} />
          </mesh>
        ))}
      </group>
      <ambientLight intensity={0.5} />
      <pointLight position={[3, 3, 4]} intensity={30} />
    </>
  );
}

function subscribe(callback: () => void) {
  const mql = window.matchMedia("(prefers-reduced-motion: reduce)");
  mql.addEventListener("change", callback);
  document.addEventListener("visibilitychange", callback);
  return () => {
    mql.removeEventListener("change", callback);
    document.removeEventListener("visibilitychange", callback);
  };
}
const snapshot = () => `${window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 1 : 0}${document.visibilityState === "visible" ? 1 : 0}`;

/** The 3D scene (lazy-loaded by AgentOrb3D). Decorative: the canvas is hidden from assistive tech. */
export default function AgentOrbScene({ state, onContextLost }: { state: AgentOrbState; onContextLost: () => void }) {
  const flags = useSyncExternalStore(subscribe, snapshot);
  const reduced = flags[0] === "1";
  const visible = flags[1] === "1";
  // Hidden tab: no frames at all. Reduced motion: one static frame per change.
  const frameloop = !visible ? "never" : reduced ? "demand" : "always";
  return (
    <Canvas
      aria-hidden="true"
      frameloop={frameloop}
      dpr={[1, 1.5]}
      camera={{ position: [0, 0, 4.6], fov: 40 }}
      gl={{ antialias: true, alpha: true, powerPreference: "low-power" }}
      onCreated={({ gl }) => gl.domElement.addEventListener("webglcontextlost", onContextLost)}
    >
      <Orb state={state} animate={!reduced} />
    </Canvas>
  );
}

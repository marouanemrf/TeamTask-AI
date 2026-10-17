import { memo, useEffect, useMemo, useRef, useState } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Environment, Lightformer, RoundedBox } from "@react-three/drei";
import { AdditiveBlending, Color, ExtrudeGeometry, NormalBlending, Path, Shape } from "three";
import type { BufferAttribute, Group } from "three";
import { cssVar } from "../../utils/cssVar";
import { useTheme } from "../../hooks/useTheme";

/* -------------------------------------------------------------------------- */
/* Constants                                                                   */
/* -------------------------------------------------------------------------- */

// All colors come from the design tokens in src/styles/theme.css.
/** Theme colours for lights and the background network (read again when the theme changes). */
function sceneColors() {
  return { primary: cssVar("--color-primary"), accent: cssVar("--color-accent"), light: cssVar("--scene-light") };
}
const CAMERA_Z = 6;

const FLOAT_AMPLITUDE = 0.08;
const FLOAT_SPEED = 0.9;
const MAX_FRAME_DELTA = 0.1; // avoids a jump when rendering resumes after a pause

const PARALLAX_X = 0.4; // ≈ 3.8° at CAMERA_Z
const PARALLAX_Y = 0.25; // ≈ 2.4°
const PARALLAX_DAMPING = 3;

const PARTICLE_COUNT = 160;
const LINK_DISTANCE = 1.7;
const MAX_LINKS_PER_NODE = 3;
const PARTICLE_DRIFT = 0.12;

/* -------------------------------------------------------------------------- */
/* Hooks                                                                       */
/* -------------------------------------------------------------------------- */

function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const mql = window.matchMedia(query);
    const onChange = () => setMatches(mql.matches);
    onChange();
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, [query]);
  return matches;
}

function useDocumentVisible(): boolean {
  const [visible, setVisible] = useState(() => document.visibilityState === "visible");
  useEffect(() => {
    const onChange = () => setVisible(document.visibilityState === "visible");
    document.addEventListener("visibilitychange", onChange);
    return () => document.removeEventListener("visibilitychange", onChange);
  }, []);
  return visible;
}

/* -------------------------------------------------------------------------- */
/* Gogo Security logo in 3D                                                    */
/* -------------------------------------------------------------------------- */

// Colours of the official logo (fixed: the logo looks the same in both themes).
const LOGO = {
  silver: "#D9DEE5",
  silverDark: "#9AA3AE",
  face: "#EEF2F7",
  blue: "#0B5FD8",
  blueDeep: "#033E99",
  cyan: "#29B6E8",
  glow: "#7DDCF2",
} as const;

interface AnimatedProps {
  animate: boolean;
}

const SWAY = 0.55; // rad: the logo turns left and right, never shows its back
const SWAY_SPEED = 0.45;

function shieldPath<T extends Shape | Path>(target: T, scale: number): T {
  const s = (v: number) => v * scale;
  target.moveTo(0, s(1.25));
  target.quadraticCurveTo(s(0.55), s(1.05), s(1), s(1));
  target.lineTo(s(1), s(0.2));
  target.quadraticCurveTo(s(0.95), s(-0.75), 0, s(-1.3));
  target.quadraticCurveTo(s(-0.95), s(-0.75), s(-1), s(0.2));
  target.lineTo(s(-1), s(1));
  target.quadraticCurveTo(s(-0.55), s(1.05), 0, s(1.25));
  return target;
}

/** Silver frame: the shield outline with its inside cut out. */
function createFrameGeometry(): ExtrudeGeometry {
  const outer = shieldPath(new Shape(), 1);
  outer.holes.push(shieldPath(new Path(), 0.84));
  return new ExtrudeGeometry(outer, { depth: 0.22, curveSegments: 24, bevelEnabled: true, bevelThickness: 0.05, bevelSize: 0.04, bevelSegments: 3 });
}

function createFaceGeometry(): ExtrudeGeometry {
  return new ExtrudeGeometry(shieldPath(new Shape(), 0.86), { depth: 0.06, curveSegments: 24, bevelEnabled: false });
}

/** The blue "wing" of the logo: top right, leaving the shield on the right side. */
function createWingGeometry(): ExtrudeGeometry {
  const w = new Shape();
  w.moveTo(0.08, 1.1);
  w.quadraticCurveTo(0.6, 1.02, 1.28, 0.98);
  w.lineTo(1.28, 0.42);
  w.lineTo(0.62, 0.42);
  w.quadraticCurveTo(0.36, 0.62, 0.08, 1.1);
  return new ExtrudeGeometry(w, { depth: 0.16, curveSegments: 16, bevelEnabled: true, bevelThickness: 0.03, bevelSize: 0.025, bevelSegments: 2 });
}

/** Circuit traces of the left half: polylines ending in a node, in shield coordinates. */
const TRACES: [number, number][][] = [
  [[-0.02, -1.0], [-0.02, 0.05], [0.14, 0.24], [0.14, 0.66]],
  [[-0.1, -0.96], [-0.1, -0.02], [-0.3, 0.2], [-0.3, 0.74]],
  [[-0.18, -0.88], [-0.18, -0.12], [-0.52, 0.22], [-0.52, 0.52]],
  [[-0.26, -0.78], [-0.26, -0.3], [-0.6, -0.02]],
  [[0.06, -0.92], [0.06, -0.06], [0.3, 0.12]],
];

function CircuitTraces() {
  const segments = useMemo(() => TRACES.flatMap((trace) => trace.slice(1).map((end, i) => {
    const start = trace[i];
    const dx = end[0] - start[0];
    const dy = end[1] - start[1];
    return { x: (start[0] + end[0]) / 2, y: (start[1] + end[1]) / 2, length: Math.hypot(dx, dy) + 0.03, angle: Math.atan2(dy, dx) };
  })), []);
  return (
    <group position-z={0.12}>
      {segments.map((seg, i) => (
        <mesh key={i} position={[seg.x, seg.y, 0]} rotation-z={seg.angle}>
          <boxGeometry args={[seg.length, 0.028, 0.03]} />
          <meshStandardMaterial color={LOGO.cyan} emissive={LOGO.cyan} emissiveIntensity={0.55} metalness={0.4} roughness={0.35} />
        </mesh>
      ))}
      {TRACES.map((trace, i) => {
        const [x, y] = trace[trace.length - 1];
        return (
          <mesh key={`node-${i}`} position={[x, y + 0.03, 0.01]}>
            <sphereGeometry args={[0.055, 16, 12]} />
            <meshStandardMaterial color={LOGO.glow} emissive={LOGO.cyan} emissiveIntensity={1.1} />
          </mesh>
        );
      })}
    </group>
  );
}

/** Halftone dots on the wing, smaller towards the shield's centre (as in the logo). */
function WingDots() {
  const dots = useMemo(() => {
    const out: { x: number; y: number; r: number }[] = [];
    for (let row = 0; row < 5; row++) {
      for (let col = 0; col < 9; col++) {
        const x = 0.42 + col * 0.095;
        const y = 0.5 + row * 0.1;
        if (x < 0.25 + (y - 0.45) * 0.4) continue;
        out.push({ x, y, r: 0.012 + (col / 8) * 0.022 });
      }
    }
    return out;
  }, []);
  return (
    <group position-z={0.375}>
      {dots.map((d, i) => (
        <mesh key={i} position={[d.x, d.y, 0]}>
          <circleGeometry args={[d.r, 10]} />
          <meshStandardMaterial color={LOGO.blueDeep} metalness={0.3} roughness={0.5} />
        </mesh>
      ))}
    </group>
  );
}

/** The orbit around the shield, with a bright arc running along it. */
function Orbit({ animate }: AnimatedProps) {
  const comet = useRef<Group>(null);
  useFrame((_, delta) => {
    if (animate && comet.current) comet.current.rotation.z -= Math.min(delta, MAX_FRAME_DELTA) * 1.1;
  });
  return (
    <group rotation={[1.2, 0.15, -0.28]} scale={[1.55, 1.55, 1.55]}>
      <mesh>
        <torusGeometry args={[1, 0.022, 12, 96]} />
        <meshStandardMaterial color={LOGO.blue} emissive={LOGO.cyan} emissiveIntensity={0.6} metalness={0.5} roughness={0.3} />
      </mesh>
      <mesh scale={0.94}>
        <torusGeometry args={[1, 0.008, 8, 96]} />
        <meshBasicMaterial color={LOGO.glow} transparent opacity={0.6} />
      </mesh>
      <group ref={comet}>
        <mesh>
          <torusGeometry args={[1, 0.036, 10, 48, Math.PI * 0.45]} />
          <meshBasicMaterial color={LOGO.glow} transparent opacity={0.9} blending={AdditiveBlending} depthWrite={false} />
        </mesh>
      </group>
    </group>
  );
}

function GogoLogo({ animate }: AnimatedProps) {
  const groupRef = useRef<Group>(null);
  const elapsed = useRef(0);
  const size = useThree((state) => state.size);
  const viewportWidth = useThree((state) => state.viewport.width);

  // Short, wide canvas (mobile header): push the logo right so the HTML brand copy has room.
  const compact = size.height < 320 && size.width / size.height > 1.3;
  const offsetX = compact ? viewportWidth * 0.26 : 0;
  const scale = compact ? 0.72 : 0.78;

  const frame = useMemo(() => createFrameGeometry(), []);
  const face = useMemo(() => createFaceGeometry(), []);
  const wing = useMemo(() => createWingGeometry(), []);
  useEffect(() => () => [frame, face, wing].forEach((g) => g.dispose()), [frame, face, wing]);

  useFrame((_, delta) => {
    const group = groupRef.current;
    if (!group || !animate) return;
    elapsed.current += Math.min(delta, MAX_FRAME_DELTA);
    group.rotation.y = -0.2 + Math.sin(elapsed.current * SWAY_SPEED) * SWAY;
    group.position.y = 0.1 + Math.sin(elapsed.current * FLOAT_SPEED) * FLOAT_AMPLITUDE;
  });

  return (
    <group position-x={offsetX} scale={scale}>
      <group ref={groupRef} position-y={0.1} rotation={[0.06, -0.2, 0]}>
        {/* Centre the extrusions (they start at z = 0). */}
        <group position-z={-0.11}>
          <mesh geometry={frame}>
            <meshStandardMaterial color={LOGO.silver} metalness={0.5} roughness={0.26} envMapIntensity={1.1} />
          </mesh>
          <mesh geometry={face} position-z={0.04}>
            <meshStandardMaterial color={LOGO.face} metalness={0.1} roughness={0.6} />
          </mesh>
          <CircuitTraces />
          <mesh geometry={wing} position-z={0.16}>
            <meshStandardMaterial color={LOGO.blue} metalness={0.55} roughness={0.28} emissive={LOGO.blueDeep} emissiveIntensity={0.25} envMapIntensity={1.2} />
          </mesh>
          <WingDots />
          {/* Grey bar under the wing */}
          <RoundedBox args={[0.78, 0.13, 0.12]} radius={0.03} smoothness={2} position={[0.82, 0.3, 0.3]}>
            <meshStandardMaterial color={LOGO.silverDark} metalness={0.45} roughness={0.35} />
          </RoundedBox>
          {/* Glow at the tip, as in the logo */}
          <mesh position={[0, -1.33, 0.2]}>
            <sphereGeometry args={[0.05, 12, 10]} />
            <meshBasicMaterial color={LOGO.glow} />
          </mesh>
          <pointLight position={[0, -1.25, 0.6]} color={LOGO.cyan} intensity={3} distance={2} />
        </group>
        <Orbit animate={animate} />
      </group>
    </group>
  );
}

/* -------------------------------------------------------------------------- */
/* Background network                                                          */
/* -------------------------------------------------------------------------- */

interface NetworkData {
  base: Float32Array;
  positions: Float32Array;
  phase: Float32Array;
  speed: Float32Array;
  pairs: Uint16Array;
  pairStrength: Float32Array;
  pairPhase: Float32Array;
  linePositions: Float32Array;
  lineColors: Float32Array;
}

/** Small deterministic PRNG so the network layout is stable between mounts. */
function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const LINE_COLOR = new Color(sceneColors().primary);

function buildNetwork(): NetworkData {
  const rand = mulberry32(0x60605ec);
  const base = new Float32Array(PARTICLE_COUNT * 3);
  const phase = new Float32Array(PARTICLE_COUNT);
  const speed = new Float32Array(PARTICLE_COUNT);

  for (let i = 0; i < PARTICLE_COUNT; i++) {
    base[i * 3] = (rand() - 0.5) * 16;
    base[i * 3 + 1] = (rand() - 0.5) * 9;
    base[i * 3 + 2] = -2.5 - rand() * 4.5;
    phase[i] = rand() * Math.PI * 2;
    speed[i] = 0.15 + rand() * 0.25;
  }

  const links: number[] = [];
  const strengths: number[] = [];
  const linkCount = new Uint8Array(PARTICLE_COUNT);
  for (let i = 0; i < PARTICLE_COUNT; i++) {
    for (let j = i + 1; j < PARTICLE_COUNT; j++) {
      if (linkCount[i] >= MAX_LINKS_PER_NODE || linkCount[j] >= MAX_LINKS_PER_NODE) continue;
      const dx = base[i * 3] - base[j * 3];
      const dy = base[i * 3 + 1] - base[j * 3 + 1];
      const dz = base[i * 3 + 2] - base[j * 3 + 2];
      const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (dist < LINK_DISTANCE) {
        links.push(i, j);
        strengths.push(1 - dist / LINK_DISTANCE);
        linkCount[i]++;
        linkCount[j]++;
      }
    }
  }

  const pairCount = strengths.length;
  const pairPhase = new Float32Array(pairCount);
  for (let k = 0; k < pairCount; k++) pairPhase[k] = rand() * Math.PI * 2;

  const data: NetworkData = {
    base,
    positions: base.slice(),
    phase,
    speed,
    pairs: Uint16Array.from(links),
    pairStrength: Float32Array.from(strengths),
    pairPhase,
    linePositions: new Float32Array(pairCount * 6),
    lineColors: new Float32Array(pairCount * 6),
  };
  writeLines(data, 0, false);
  return data;
}

/** Copies particle positions into the line buffer and writes per-line brightness. */
function writeLines(data: NetworkData, time: number, pulse: boolean) {
  const { positions, pairs, pairStrength, pairPhase, linePositions, lineColors } = data;
  for (let k = 0; k < pairStrength.length; k++) {
    const a = pairs[k * 2] * 3;
    const b = pairs[k * 2 + 1] * 3;
    const o = k * 6;
    linePositions[o] = positions[a];
    linePositions[o + 1] = positions[a + 1];
    linePositions[o + 2] = positions[a + 2];
    linePositions[o + 3] = positions[b];
    linePositions[o + 4] = positions[b + 1];
    linePositions[o + 5] = positions[b + 2];

    const wave = pulse ? 0.65 + 0.35 * Math.sin(time * 0.8 + pairPhase[k]) : 0.8;
    const intensity = pairStrength[k] * wave * 0.55;
    const r = LINE_COLOR.r * intensity;
    const g = LINE_COLOR.g * intensity;
    const bl = LINE_COLOR.b * intensity;
    lineColors[o] = r;
    lineColors[o + 1] = g;
    lineColors[o + 2] = bl;
    lineColors[o + 3] = r;
    lineColors[o + 4] = g;
    lineColors[o + 5] = bl;
  }
}

/** Advances the gentle particle drift and refreshes the line buffers in place. */
function stepNetwork(data: NetworkData, time: number) {
  const { base, positions, phase, speed } = data;
  for (let i = 0; i < PARTICLE_COUNT; i++) {
    const p = i * 3;
    positions[p] = base[p] + Math.sin(time * speed[i] + phase[i]) * PARTICLE_DRIFT;
    positions[p + 1] = base[p + 1] + Math.cos(time * speed[i] * 0.8 + phase[i]) * PARTICLE_DRIFT;
  }
  writeLines(data, time, true);
}

function Network({ animate, color, accent, light }: AnimatedProps & { color: string; accent: string; light: boolean }) {
  const data = useMemo(() => buildNetwork(), []);
  // The line colour follows the theme: applied on the next frame (buffers are only touched there).
  const applied = useRef(color);
  const pointPositionRef = useRef<BufferAttribute>(null);
  const linePositionRef = useRef<BufferAttribute>(null);
  const lineColorRef = useRef<BufferAttribute>(null);

  useFrame(({ clock }) => {
    if (applied.current !== color) {
      applied.current = color;
      LINE_COLOR.set(color);
      writeLines(data, clock.elapsedTime, animate);
      if (lineColorRef.current) lineColorRef.current.needsUpdate = true;
    }
    if (!animate) return;
    stepNetwork(data, clock.elapsedTime);
    if (pointPositionRef.current) pointPositionRef.current.needsUpdate = true;
    if (linePositionRef.current) linePositionRef.current.needsUpdate = true;
    if (lineColorRef.current) lineColorRef.current.needsUpdate = true;
  });

  return (
    <group>
      <points frustumCulled={false}>
        <bufferGeometry>
          <bufferAttribute ref={pointPositionRef} attach="attributes-position" args={[data.positions, 3]} />
        </bufferGeometry>
        <pointsMaterial color={accent} size={0.045} sizeAttenuation transparent opacity={0.7} depthWrite={false} />
      </points>
      <lineSegments frustumCulled={false}>
        <bufferGeometry>
          <bufferAttribute ref={linePositionRef} attach="attributes-position" args={[data.linePositions, 3]} />
          <bufferAttribute ref={lineColorRef} attach="attributes-color" args={[data.lineColors, 3]} />
        </bufferGeometry>
        <lineBasicMaterial vertexColors transparent opacity={light ? 0.35 : 1} blending={light ? NormalBlending : AdditiveBlending} depthWrite={false} />
      </lineSegments>
    </group>
  );
}

/* -------------------------------------------------------------------------- */
/* Camera parallax                                                             */
/* -------------------------------------------------------------------------- */

function CameraRig({ enabled }: { enabled: boolean }) {
  const camera = useThree((state) => state.camera);
  const invalidate = useThree((state) => state.invalidate);
  const target = useRef({ x: 0, y: 0 });

  useEffect(() => {
    target.current = { x: 0, y: 0 };
    if (!enabled) {
      camera.position.set(0, 0, CAMERA_Z);
      camera.lookAt(0, 0, 0);
      invalidate();
      return;
    }
    const onPointerMove = (event: PointerEvent) => {
      target.current.x = (event.clientX / window.innerWidth) * 2 - 1;
      target.current.y = -((event.clientY / window.innerHeight) * 2 - 1);
    };
    window.addEventListener("pointermove", onPointerMove, { passive: true });
    return () => window.removeEventListener("pointermove", onPointerMove);
  }, [enabled, camera, invalidate]);

  useFrame(({ camera }, delta) => {
    if (!enabled) return;
    const k = 1 - Math.exp(-Math.min(delta, MAX_FRAME_DELTA) * PARALLAX_DAMPING);
    camera.position.x += (target.current.x * PARALLAX_X - camera.position.x) * k;
    camera.position.y += (target.current.y * PARALLAX_Y - camera.position.y) * k;
    camera.lookAt(0, 0, 0);
  });

  return null;
}

/* -------------------------------------------------------------------------- */
/* Scene                                                                       */
/* -------------------------------------------------------------------------- */

const SceneContents = memo(function SceneContents({ animate }: AnimatedProps) {
  const { theme } = useTheme();
  // eslint-disable-next-line react-hooks/exhaustive-deps -- the tokens change with the theme
  const { primary: PRIMARY, accent: ACCENT, light: LIGHT_COLOR } = useMemo(() => sceneColors(), [theme]);
  return (
    <>
      <ambientLight intensity={0.25} />
      <directionalLight position={[3, 4, 5]} intensity={1.4} />
      <pointLight position={[-3, 1.5, -1.5]} color={PRIMARY} intensity={14} />
      <pointLight position={[3, -2, 2]} color={ACCENT} intensity={8} />

      {/* Local, procedurally lit environment for metal reflections — no HDR download. */}
      <Environment key={theme} resolution={64} frames={1}>
        <Lightformer form="rect" intensity={1.4} color={LIGHT_COLOR} position={[0, 3, 4]} scale={[6, 2, 1]} />
        <Lightformer form="rect" intensity={1.6} color={PRIMARY} position={[-4, 0, 1]} rotation-y={Math.PI / 2} scale={[4, 4, 1]} />
        <Lightformer form="rect" intensity={1.2} color={ACCENT} position={[4, -1, 1]} rotation-y={-Math.PI / 2} scale={[4, 4, 1]} />
      </Environment>

      <Network animate={animate} color={PRIMARY} accent={ACCENT} light={theme === "light"} />
      <GogoLogo animate={animate} />
      <CameraRig enabled={animate} />
    </>
  );
});

/** Fires once the scene has mounted and the renderer has had time to draw its first frames. */
function ReadySignal({ onReady }: { onReady: () => void }) {
  useEffect(() => {
    let second = 0;
    const first = requestAnimationFrame(() => {
      second = requestAnimationFrame(onReady);
    });
    return () => {
      cancelAnimationFrame(first);
      cancelAnimationFrame(second);
    };
  }, [onReady]);
  return null;
}

export interface LoginScene3DProps {
  /** Called if the WebGL context is lost so the parent can swap in a static fallback. */
  onContextLost?: () => void;
  /** Called once the first frame has been rendered. */
  onReady?: () => void;
}

function LoginScene3D({ onContextLost, onReady }: LoginScene3DProps) {
  const prefersReducedMotion = useMediaQuery("(prefers-reduced-motion: reduce)");
  const visible = useDocumentVisible();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const onContextLostRef = useRef(onContextLost);

  useEffect(() => {
    onContextLostRef.current = onContextLost;
  }, [onContextLost]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const handleLost = () => onContextLostRef.current?.();
    canvas.addEventListener("webglcontextlost", handleLost);
    return () => canvas.removeEventListener("webglcontextlost", handleLost);
  }, []);

  const animate = !prefersReducedMotion;
  // Hidden tab: stop the loop entirely. Reduced motion: render on demand (one static frame).
  const frameloop = !visible ? "never" : animate ? "always" : "demand";

  return (
    <Canvas
      ref={canvasRef}
      aria-hidden="true"
      frameloop={frameloop}
      dpr={[1, 1.5]}
      camera={{ position: [0, 0, CAMERA_Z], fov: 40, near: 0.1, far: 50 }}
      gl={{ antialias: true, alpha: true, powerPreference: "low-power" }}
    >
      <SceneContents animate={animate} />
      {onReady && <ReadySignal onReady={onReady} />}
    </Canvas>
  );
}

export default LoginScene3D;

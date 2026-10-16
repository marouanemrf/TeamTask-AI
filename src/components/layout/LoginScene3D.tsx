import { memo, useEffect, useMemo, useRef, useState } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Edges, Environment, Lightformer, RoundedBox } from "@react-three/drei";
import { AdditiveBlending, Color, ExtrudeGeometry, Shape } from "three";
import type { BufferAttribute, Group } from "three";
import { cssVar } from "../../utils/cssVar";

/* -------------------------------------------------------------------------- */
/* Constants                                                                   */
/* -------------------------------------------------------------------------- */

// All colors come from the design tokens in src/styles/theme.css.
const PRIMARY = cssVar("--color-primary");
const ACCENT = cssVar("--color-accent");
const SHIELD_COLOR = cssVar("--scene-shield");
const PLATE_COLOR = cssVar("--scene-plate");
const SHACKLE_COLOR = cssVar("--scene-lock-shackle");
const LOCK_BODY_COLOR = cssVar("--scene-lock-body");
const KEYHOLE_COLOR = cssVar("--scene-keyhole");
const LIGHT_COLOR = cssVar("--scene-light");
const CAMERA_Z = 6;

const ROTATION_SPEED = 0.2; // rad/s
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
/* Shield + padlock                                                            */
/* -------------------------------------------------------------------------- */

function createShieldShape(scale: number): Shape {
  const s = (v: number) => v * scale;
  const shape = new Shape();
  shape.moveTo(0, s(1.25));
  shape.quadraticCurveTo(s(0.55), s(1.05), s(1), s(1));
  shape.lineTo(s(1), s(0.2));
  shape.quadraticCurveTo(s(0.95), s(-0.75), 0, s(-1.3));
  shape.quadraticCurveTo(s(-0.95), s(-0.75), s(-1), s(0.2));
  shape.lineTo(s(-1), s(1));
  shape.quadraticCurveTo(s(-0.55), s(1.05), 0, s(1.25));
  return shape;
}

function createShieldGeometry(scale: number, depth: number, bevel: number): ExtrudeGeometry {
  const geometry = new ExtrudeGeometry(createShieldShape(scale), {
    depth,
    curveSegments: 4, // deliberately low for a faceted, low-poly silhouette
    bevelEnabled: true,
    bevelThickness: bevel,
    bevelSize: bevel,
    bevelSegments: 1,
  });
  geometry.center();
  return geometry;
}

interface AnimatedProps {
  animate: boolean;
}

function Shield({ animate }: AnimatedProps) {
  const groupRef = useRef<Group>(null);
  const elapsed = useRef(0);
  const size = useThree((state) => state.size);
  const viewportWidth = useThree((state) => state.viewport.width);

  // Short, wide canvas (mobile header): push the shield right so the HTML brand copy has room.
  const compact = size.height < 320 && size.width / size.height > 1.3;
  const offsetX = compact ? viewportWidth * 0.26 : 0;
  const scale = compact ? 0.85 : 0.88;

  const outerGeometry = useMemo(() => createShieldGeometry(1, 0.3, 0.08), []);
  const innerGeometry = useMemo(() => createShieldGeometry(0.78, 0.06, 0.03), []);
  useEffect(
    () => () => {
      outerGeometry.dispose();
      innerGeometry.dispose();
    },
    [outerGeometry, innerGeometry],
  );

  useFrame((_, delta) => {
    const group = groupRef.current;
    if (!group || !animate) return;
    const dt = Math.min(delta, MAX_FRAME_DELTA);
    elapsed.current += dt;
    group.rotation.y += dt * ROTATION_SPEED;
    group.position.y = 0.15 + Math.sin(elapsed.current * FLOAT_SPEED) * FLOAT_AMPLITUDE;
  });

  return (
    <group position-x={offsetX} scale={scale}>
      <group ref={groupRef} position-y={0.15} rotation={[0.08, -0.35, 0]}>
        {/* Outer shell */}
        <mesh geometry={outerGeometry}>
          <meshStandardMaterial color={SHIELD_COLOR} metalness={0.8} roughness={0.3} flatShading envMapIntensity={1.4} />
          <Edges threshold={20} color={PRIMARY} lineWidth={1.2} transparent opacity={0.55} />
        </mesh>

        {/* Inset face plate */}
        <mesh geometry={innerGeometry} position-z={0.22}>
          <meshStandardMaterial
            color={PLATE_COLOR}
            metalness={0.75}
            roughness={0.45}
            flatShading
            emissive={PRIMARY}
            emissiveIntensity={0.01}
          />
          <Edges threshold={20} color={PRIMARY} lineWidth={1} transparent opacity={0.3} />
        </mesh>

        <Padlock />
      </group>
    </group>
  );
}

function Padlock() {
  return (
    <group position={[0, -0.02, 0.36]} scale={0.95}>
      {/* Shackle */}
      <mesh position-y={0.25}>
        <torusGeometry args={[0.2, 0.045, 6, 12, Math.PI]} />
        <meshStandardMaterial color={SHACKLE_COLOR} metalness={0.95} roughness={0.25} flatShading />
      </mesh>
      {[-0.2, 0.2].map((x) => (
        <mesh key={x} position={[x, 0.19, 0]}>
          <cylinderGeometry args={[0.045, 0.045, 0.14, 6]} />
          <meshStandardMaterial color={SHACKLE_COLOR} metalness={0.95} roughness={0.25} flatShading />
        </mesh>
      ))}

      {/* Body */}
      <RoundedBox args={[0.64, 0.5, 0.18]} radius={0.05} smoothness={2} position-y={-0.12}>
        <meshStandardMaterial color={LOCK_BODY_COLOR} metalness={0.9} roughness={0.3} flatShading />
      </RoundedBox>

      {/* Keyhole */}
      <group position={[0, -0.1, 0.091]}>
        <mesh>
          <circleGeometry args={[0.055, 10]} />
          <meshStandardMaterial color={KEYHOLE_COLOR} emissive={PRIMARY} emissiveIntensity={1.1} />
        </mesh>
        <mesh position-y={-0.075}>
          <planeGeometry args={[0.04, 0.11]} />
          <meshStandardMaterial color={KEYHOLE_COLOR} emissive={PRIMARY} emissiveIntensity={1.1} />
        </mesh>
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

const LINE_COLOR = new Color(PRIMARY);

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

function Network({ animate }: AnimatedProps) {
  const data = useMemo(() => buildNetwork(), []);
  const pointPositionRef = useRef<BufferAttribute>(null);
  const linePositionRef = useRef<BufferAttribute>(null);
  const lineColorRef = useRef<BufferAttribute>(null);

  useFrame(({ clock }) => {
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
        <pointsMaterial color={ACCENT} size={0.045} sizeAttenuation transparent opacity={0.7} depthWrite={false} />
      </points>
      <lineSegments frustumCulled={false}>
        <bufferGeometry>
          <bufferAttribute ref={linePositionRef} attach="attributes-position" args={[data.linePositions, 3]} />
          <bufferAttribute ref={lineColorRef} attach="attributes-color" args={[data.lineColors, 3]} />
        </bufferGeometry>
        <lineBasicMaterial vertexColors transparent blending={AdditiveBlending} depthWrite={false} />
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
  return (
    <>
      <ambientLight intensity={0.25} />
      <directionalLight position={[3, 4, 5]} intensity={1.4} />
      <pointLight position={[-3, 1.5, -1.5]} color={PRIMARY} intensity={14} />
      <pointLight position={[3, -2, 2]} color={ACCENT} intensity={8} />

      {/* Local, procedurally lit environment for metal reflections — no HDR download. */}
      <Environment resolution={64} frames={1}>
        <Lightformer form="rect" intensity={1.4} color={LIGHT_COLOR} position={[0, 3, 4]} scale={[6, 2, 1]} />
        <Lightformer form="rect" intensity={1.6} color={PRIMARY} position={[-4, 0, 1]} rotation-y={Math.PI / 2} scale={[4, 4, 1]} />
        <Lightformer form="rect" intensity={1.2} color={ACCENT} position={[4, -1, 1]} rotation-y={-Math.PI / 2} scale={[4, 4, 1]} />
      </Environment>

      <Network animate={animate} />
      <Shield animate={animate} />
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

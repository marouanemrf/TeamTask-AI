import { Component, lazy, Suspense, useCallback, useEffect, useState } from "react";
import type { ReactNode } from "react";
import BrandLogo from "../ui/BrandLogo";

const LoginScene3D = lazy(() => import("./LoginScene3D"));

/** Never keep people on the loader longer than this, whatever happens. */
const LOADER_TIMEOUT_MS = 8000;
/** Matches the fade-out duration in theme.css. */
const LOADER_FADE_MS = 300;

/** three.js (r163+) requires WebGL 2. Checked up front so we never download the 3D bundle needlessly. */
function isWebGL2Available(): boolean {
  try {
    const canvas = document.createElement("canvas");
    const gl = canvas.getContext("webgl2");
    if (!gl) return false;
    gl.getExtension("WEBGL_lose_context")?.loseContext();
    return true;
  } catch {
    return false;
  }
}

interface SceneBoundaryProps {
  fallback: ReactNode;
  children: ReactNode;
  onError?: () => void;
}

interface SceneBoundaryState {
  failed: boolean;
}

/** Catches lazy-chunk load failures and canvas/renderer initialisation errors. */
class SceneBoundary extends Component<SceneBoundaryProps, SceneBoundaryState> {
  state: SceneBoundaryState = { failed: false };

  static getDerivedStateFromError(): SceneBoundaryState {
    return { failed: true };
  }

  componentDidCatch(error: unknown) {
    console.warn("[LoginLayout] 3D scene unavailable, showing static fallback.", error);
    this.props.onError?.();
  }

  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

function ScenePlaceholder() {
  return <div className="scene-placeholder" aria-hidden="true" />;
}

function StaticShield() {
  return (
    <div className="scene-placeholder scene-fallback" aria-hidden="true">
      <svg className="static-shield" viewBox="0 0 120 140" fill="none">
        <path
          className="static-shield__outer"
          d="M60 6 92 16 112 18v52c0 30-22 52-52 64C30 122 8 100 8 70V18l20-2Z"
          strokeWidth="2"
          strokeLinejoin="round"
        />
        <path
          className="static-shield__inner"
          d="M60 20 84 27 98 28v42c0 23-16 40-38 50-22-10-38-27-38-50V28l14-1Z"
          strokeWidth="1.5"
          strokeLinejoin="round"
        />
        <path className="static-shield__shackle" d="M48 64v-9a12 12 0 0 1 24 0v9" strokeWidth="5" strokeLinecap="round" />
        <rect className="static-shield__body" x="40" y="62" width="40" height="30" rx="4" />
        <circle className="static-shield__keyhole" cx="60" cy="74" r="3.5" />
        <rect className="static-shield__keyhole" x="58.5" y="75" width="3" height="8" rx="1.5" />
      </svg>
    </div>
  );
}

function PageLoader({ leaving }: { leaving: boolean }) {
  return (
    <div className={`page-loader${leaving ? " page-loader--leaving" : ""}`} role="status" aria-live="polite">
      <BrandMark />
      <span className="page-loader__spinner" aria-hidden="true" />
      <span className="page-loader__label">Loading…</span>
    </div>
  );
}

/** Resolves once web fonts are ready so the page doesn't reflow after the loader leaves. */
function useFontsReady(): boolean {
  const [ready, setReady] = useState(() => !("fonts" in document));
  useEffect(() => {
    if (ready) return;
    let active = true;
    document.fonts.ready.then(
      () => active && setReady(true),
      () => active && setReady(true),
    );
    return () => {
      active = false;
    };
  }, [ready]);
  return ready;
}

/** The official logo, sized like the former shield mark. */
function BrandMark() {
  return <BrandLogo className="login-brand__mark" />;
}

export interface LoginLayoutProps {
  children: ReactNode;
}

function LoginLayout({ children }: LoginLayoutProps) {
  const [sceneAvailable, setSceneAvailable] = useState(isWebGL2Available);
  const [sceneSettled, setSceneSettled] = useState(false);
  const [timedOut, setTimedOut] = useState(false);
  const [loaderMounted, setLoaderMounted] = useState(true);
  const fontsReady = useFontsReady();

  const handleContextLost = useCallback(() => setSceneAvailable(false), []);
  const handleSceneSettled = useCallback(() => setSceneSettled(true), []);

  // Ready when fonts are in and the scene has drawn (or we've fallen back to the static shield).
  const ready = timedOut || (fontsReady && (sceneSettled || !sceneAvailable));

  useEffect(() => {
    const id = window.setTimeout(() => setTimedOut(true), LOADER_TIMEOUT_MS);
    return () => window.clearTimeout(id);
  }, []);

  useEffect(() => {
    if (!ready) return;
    const id = window.setTimeout(() => setLoaderMounted(false), LOADER_FADE_MS);
    return () => window.clearTimeout(id);
  }, [ready]);

  return (
    <>
      {loaderMounted && <PageLoader leaving={ready} />}
      <div className="login-layout" inert={!ready} aria-hidden={!ready || undefined}>
        <div className="login-visual">
          <div className="login-visual__scene">
            {sceneAvailable ? (
              <SceneBoundary fallback={<StaticShield />} onError={handleSceneSettled}>
                <Suspense fallback={<ScenePlaceholder />}>
                  <LoginScene3D onContextLost={handleContextLost} onReady={handleSceneSettled} />
                </Suspense>
              </SceneBoundary>
            ) : (
              <StaticShield />
            )}
          </div>

          <div className="login-brand">
            <p className="login-brand__name">
              <BrandMark />
              Gogo Security
            </p>
            <p className="login-brand__tagline">Team Task</p>
          </div>
        </div>

        <div className="login-panel">
          <main className="login-panel__main">
            <section className="login-card">
              {children}
            </section>
          </main>
        </div>
      </div>
    </>
  );
}

export default LoginLayout;

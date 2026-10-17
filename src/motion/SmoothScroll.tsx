import { useEffect, useRef, useState } from "react";
import Lenis from "lenis";
import "lenis/dist/lenis.css";
import { useLocation } from "react-router-dom";
import { gsap, onReducedMotionChange, prefersReducedMotion, ScrollTrigger } from "./gsap";

/** Scroll containers Lenis must leave alone (they scroll natively). */
const NATIVE_SCROLL = "dialog, [data-lenis-prevent], .toaster, .table-wrapper, .tabs, .kanban";

/**
 * Lenis smooth scrolling for the signed-in app, driven by the GSAP ticker so ScrollTrigger and
 * Lenis share one animation loop. Created once (per reduced-motion setting); off when the user
 * prefers reduced motion. Paused while a modal dialog is open, and the page goes back to the top
 * on navigation. Renders nothing.
 */
function SmoothScroll() {
  const [reduced, setReduced] = useState(prefersReducedMotion);
  const lenisRef = useRef<Lenis | null>(null);
  const { pathname } = useLocation();

  useEffect(() => onReducedMotionChange(() => setReduced(prefersReducedMotion())), []);

  useEffect(() => {
    if (reduced) return;
    const instance = new Lenis({
      autoRaf: false,
      lerp: 0.12,
      smoothWheel: true,
      anchors: true,
      allowNestedScroll: true,
      prevent: (node) => !!node.closest(NATIVE_SCROLL),
    });
    const onScroll = () => ScrollTrigger.update();
    instance.on("scroll", onScroll);
    const tick = (time: number) => instance.raf(time * 1000);
    gsap.ticker.add(tick);
    // Lenis and ScrollTrigger must see the same time: no catch-up jumps after a long frame.
    gsap.ticker.lagSmoothing(0);

    // A modal dialog makes the page inert: stop smoothing the page behind it.
    let dialogOpen = false;
    const syncDialogs = () => {
      const open = !!document.querySelector("dialog[open]");
      if (open === dialogOpen) return;
      dialogOpen = open;
      if (open) instance.stop();
      else instance.start();
    };
    const observer = new MutationObserver(syncDialogs);
    // Dialogs open/close by attribute, or disappear when React unmounts them.
    observer.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ["open"] });

    lenisRef.current = instance;
    return () => {
      observer.disconnect();
      gsap.ticker.remove(tick);
      gsap.ticker.lagSmoothing(500, 33);
      instance.off("scroll", onScroll);
      instance.destroy();
      lenisRef.current = null;
    };
  }, [reduced]);

  // New page: start at the top (immediately, no animated jump).
  useEffect(() => {
    if (lenisRef.current) lenisRef.current.scrollTo(0, { immediate: true, force: true });
    else window.scrollTo(0, 0);
  }, [pathname]);

  return null;
}

export default SmoothScroll;

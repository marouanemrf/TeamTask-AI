import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { useGSAP } from "@gsap/react";

// Registered once for the whole app (importing this module is enough).
gsap.registerPlugin(ScrollTrigger, useGSAP);

/** Shared motion language: short, eased, never in the way. */
export const MOTION = {
  duration: 0.45,
  ease: "power2.out",
  distance: 12,
  stagger: 0.045,
} as const;

const reducedQuery = typeof window !== "undefined" ? window.matchMedia("(prefers-reduced-motion: reduce)") : null;

/** The user asked for less motion (checked at call time, so a change in the OS setting applies). */
export function prefersReducedMotion(): boolean {
  return reducedQuery?.matches ?? false;
}

export function onReducedMotionChange(callback: () => void): () => void {
  reducedQuery?.addEventListener("change", callback);
  return () => reducedQuery?.removeEventListener("change", callback);
}

export { gsap, ScrollTrigger, useGSAP };

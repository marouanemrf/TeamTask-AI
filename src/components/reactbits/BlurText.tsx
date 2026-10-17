/*
 * BlurText — adapted from React Bits (https://github.com/DavidHDev/react-bits, TextAnimations/BlurText),
 * MIT + Commons Clause, (c) David Haz. Same props and effect (words or letters come into focus from
 * a blur, one after the other), animated with GSAP instead of `motion` so the app keeps a single
 * animation library. Screen readers get the plain text; reduced motion shows it at once.
 */
import { useRef } from "react";
import type { ElementType } from "react";
import { gsap, prefersReducedMotion, useGSAP } from "../../motion/gsap";

export interface BlurTextProps {
  text: string;
  /** Delay between two pieces, in ms (React Bits default: 200). */
  delay?: number;
  className?: string;
  animateBy?: "words" | "letters";
  direction?: "top" | "bottom";
  /** Duration of one piece, in seconds. */
  stepDuration?: number;
  /** Blur at the start, in px. */
  blur?: number;
  /** Travel at the start, in px. */
  distance?: number;
  as?: ElementType;
  id?: string;
}

function BlurText({ text, delay = 200, className = "", animateBy = "words", direction = "top", stepDuration = 0.35, blur = 10, distance = 12, as: Tag = "p", id }: BlurTextProps) {
  const root = useRef<HTMLElement>(null);
  const pieces = animateBy === "words" ? text.split(" ") : Array.from(text);

  useGSAP(
    () => {
      if (prefersReducedMotion() || !root.current) return;
      gsap.fromTo(
        root.current.querySelectorAll(".blur-text__piece"),
        { opacity: 0, filter: `blur(${blur}px)`, y: direction === "top" ? -distance : distance },
        { opacity: 1, filter: "blur(0px)", y: 0, duration: stepDuration, ease: "power2.out", stagger: delay / 1000, clearProps: "filter,transform,opacity" },
      );
    },
    { scope: root, dependencies: [text] },
  );

  return (
    <Tag ref={root} id={id} className={`blur-text${className ? ` ${className}` : ""}`} aria-label={text}>
      {pieces.map((piece, i) => (
        <span key={`${i}-${piece}`} className="blur-text__piece" aria-hidden="true">
          {piece}
          {animateBy === "words" && i < pieces.length - 1 ? " " : ""}
        </span>
      ))}
    </Tag>
  );
}

export default BlurText;

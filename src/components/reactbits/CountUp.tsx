/*
 * CountUp — adapted from React Bits (https://github.com/DavidHDev/react-bits, TextAnimations/CountUp),
 * MIT + Commons Clause, (c) David Haz. Same idea and props (to, from, duration, delay, separator,
 * decimals from the values), animated with GSAP instead of `motion`. Counts once when it scrolls
 * into view, then follows value changes with a short tween (under a second; `data-counting` is
 * set meanwhile). Reduced motion shows the value directly.
 */
import { useLayoutEffect, useRef } from "react";
import { gsap, prefersReducedMotion } from "../../motion/gsap";

export interface CountUpProps {
  to: number;
  from?: number;
  /** Seconds. */
  duration?: number;
  /** Seconds before counting. */
  delay?: number;
  separator?: string;
  className?: string;
}

function format(value: number, decimals: number, separator: string) {
  const text = value.toLocaleString("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals, useGrouping: !!separator });
  return separator ? text.replace(/,/g, separator) : text;
}

function CountUp({ to, from = 0, duration = 1, delay = 0, separator = "", className = "" }: CountUpProps) {
  const el = useRef<HTMLSpanElement>(null);
  const shown = useRef(from);
  const started = useRef(false);
  const decimals = Math.max(...[to, from].map((n) => (String(n).split(".")[1] ?? "").length));

  // The text is written only here (never by React), so React and the tween never fight over it.
  useLayoutEffect(() => {
    const node = el.current;
    if (!node) return;
    const render = (value: number) => {
      shown.current = value;
      node.textContent = format(value, decimals, separator);
    };
    if (prefersReducedMotion()) {
      render(to);
      return;
    }
    const state = { value: shown.current };
    let tween: gsap.core.Tween | null = null;
    const run = (first: boolean) => {
      node.dataset.counting = "true";
      tween = gsap.to(state, {
        value: to,
        duration: first ? duration : Math.min(0.6, duration),
        delay: first ? delay : 0,
        ease: "power2.out",
        onUpdate: () => render(state.value),
        onComplete: () => {
          render(to);
          delete node.dataset.counting;
        },
      });
    };
    if (started.current) {
      run(false);
      return () => {
        tween?.kill();
        delete node.dataset.counting;
      };
    }
    render(from);
    const observer = new IntersectionObserver((entries) => {
      if (!entries.some((e) => e.isIntersecting)) return;
      observer.disconnect();
      started.current = true;
      run(true);
    });
    observer.observe(node);
    return () => {
      observer.disconnect();
      tween?.kill();
      delete node.dataset.counting;
    };
  }, [to, from, duration, delay, separator, decimals]);

  return <span ref={el} className={className} />;
}

export default CountUp;

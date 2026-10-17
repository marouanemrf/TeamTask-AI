import { useEffect } from "react";
import { gsap, MOTION, prefersReducedMotion, ScrollTrigger } from "./gsap";

/**
 * What gets a reveal: page sections, cards, list items and the first table rows. Kanban cards are
 * left alone (drag and drop moves them), and nothing inside dialogs or the assistant panel.
 */
const SELECTOR = [
  ".page-stack > :not(.tabs-bar):not(.toolbar)",
  ".stat-card",
  ".member-card",
  ".panel",
  ".my-task",
  ".eisenhower-card",
  ".item-list__item",
  ".data-table tbody tr:nth-child(-n+30)",
].join(",");
const EXCLUDED = "dialog, .kanban, .toaster, .assistant-panel";
const MAX_PER_BATCH = 60;

/**
 * Reveals content of the element matching `rootSelector` as it appears: elements already on screen fade/slide in at once
 * (lightly staggered), elements below the fold when they scroll into view (ScrollTrigger.batch,
 * once). Works for content that arrives later (live data) through a MutationObserver. Content is
 * never left hidden: only elements below the viewport wait for their trigger; an element is
 * animated once; everything is cleaned up on route change / unmount. Off with reduced motion.
 */
export function useReveal(rootSelector: string, routeKey: string) {
  useEffect(() => {
    const container = document.querySelector<HTMLElement>(rootSelector);
    if (!container || prefersReducedMotion()) return;

    const triggers: ScrollTrigger[] = [];
    const tweens: gsap.core.Tween[] = [];
    let frame = 0;
    const pending = new Set<HTMLElement>();
    const show = { opacity: 1, y: 0, duration: MOTION.duration, ease: MOTION.ease, clearProps: "transform,opacity" };

    const collect = (scope: ParentNode) => {
      const nodes = scope instanceof HTMLElement && scope.matches(SELECTOR) ? [scope] : [];
      nodes.push(...Array.from(scope.querySelectorAll<HTMLElement>(SELECTOR)));
      for (const el of nodes) {
        if (el.dataset.revealed || el.closest(EXCLUDED)) continue;
        el.dataset.revealed = "1";
        // Its parent is being revealed right now: the child moves with it.
        const parent = el.parentElement?.closest<HTMLElement>("[data-revealed]");
        if (parent && pending.has(parent)) continue;
        pending.add(el);
      }
    };

    const flush = () => {
      frame = 0;
      const items = [...pending].filter((el) => el.isConnected).slice(0, MAX_PER_BATCH);
      pending.clear();
      if (!items.length) return;
      const fold = window.innerHeight;
      const visible = items.filter((el) => el.getBoundingClientRect().top < fold);
      const below = items.filter((el) => el.getBoundingClientRect().top >= fold);
      if (visible.length) {
        tweens.push(gsap.fromTo(visible, { opacity: 0, y: MOTION.distance }, { ...show, stagger: { each: MOTION.stagger, amount: Math.min(0.35, visible.length * MOTION.stagger) } }));
      }
      if (below.length) {
        // Opacity only (never visibility): links and buttons inside stay reachable by keyboard.
        gsap.set(below, { opacity: 0, y: MOTION.distance });
        below.forEach((el) => (el.dataset.revealPending = "1"));
        triggers.push(...ScrollTrigger.batch(below, {
          start: "top 96%",
          once: true,
          onEnter: (batch) => {
            batch.forEach((el) => delete (el as HTMLElement).dataset.revealPending);
            tweens.push(gsap.to(batch, { ...show, stagger: MOTION.stagger }));
          },
        }));
        ScrollTrigger.refresh();
      }
    };

    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(flush);
    };

    collect(container);
    schedule();
    const observer = new MutationObserver((records) => {
      for (const record of records) record.addedNodes.forEach((node) => node instanceof HTMLElement && collect(node));
      if (pending.size) schedule();
    });
    observer.observe(container, { childList: true, subtree: true });
    // Keyboard focus inside an element still waiting below the fold: show it now.
    const onFocus = (event: FocusEvent) => {
      const el = (event.target as HTMLElement | null)?.closest<HTMLElement>("[data-reveal-pending]");
      if (!el) return;
      delete el.dataset.revealPending;
      gsap.set(el, { clearProps: "transform,opacity" });
    };
    container.addEventListener("focusin", onFocus);

    return () => {
      container.removeEventListener("focusin", onFocus);
      observer.disconnect();
      cancelAnimationFrame(frame);
      triggers.forEach((t) => t.kill());
      // Finish (not freeze) running reveals so nothing stays half visible.
      tweens.forEach((t) => t.progress(1).kill());
      container.querySelectorAll<HTMLElement>("[data-revealed]").forEach((el) => {
        delete el.dataset.revealed;
        delete el.dataset.revealPending;
        gsap.set(el, { clearProps: "transform,opacity" });
      });
    };
  }, [rootSelector, routeKey]);
}

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { CloseIcon } from "./Icons";
import { ToastContext } from "./toastContext";
import type { Toast, ToastInput, ToastType } from "./toastContext";

/** Each toast closes by itself after 10 seconds (paused while hovered or focused). */
const TOAST_DURATION_MS = 10_000;
const EXIT_MS = 200;
const TITLES: Record<ToastType, string> = { success: "Done", error: "Error", warning: "Warning", info: "Information" };

function ToastItem({ toast, onClose }: { toast: Toast; onClose: (id: number) => void }) {
  const [paused, setPaused] = useState(false);
  const remaining = useRef(TOAST_DURATION_MS);
  const startedAt = useRef(0);

  // One timer per toast: runs while not paused, keeps the time left when paused, cleared on unmount.
  useEffect(() => {
    if (paused || toast.leaving) return;
    startedAt.current = Date.now();
    const timer = window.setTimeout(() => onClose(toast.id), remaining.current);
    return () => {
      window.clearTimeout(timer);
      remaining.current = Math.max(0, remaining.current - (Date.now() - startedAt.current));
    };
  }, [paused, toast.leaving, toast.id, onClose]);

  const urgent = toast.type === "error" || toast.type === "warning";
  return (
    <div
      className={`toast toast--${toast.type}${toast.leaving ? " toast--leaving" : ""}`}
      role={urgent ? "alert" : "status"}
      aria-live={urgent ? "assertive" : "polite"}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setPaused(false);
      }}
    >
      <span className="toast__icon" aria-hidden="true" />
      <div className="toast__body">
        <p className="toast__title">{toast.title ?? TITLES[toast.type]}</p>
        <p className="toast__message">{toast.message}</p>
      </div>
      <button type="button" className="icon-button toast__close" aria-label="Dismiss notification" onClick={() => onClose(toast.id)}>
        <CloseIcon />
      </button>
      {!toast.leaving && <span className="toast__timer" aria-hidden="true" style={{ animationDuration: `${TOAST_DURATION_MS}ms`, animationPlayState: paused ? "paused" : "running" }} />}
    </div>
  );
}

/**
 * App-wide notifications, stacked at the top right (top, full width on phones). The stack is a
 * manual popover in the browser's top layer, raised again whenever a dialog opens, so it is never
 * hidden behind headers, drawers or modal dialogs.
 */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(1);
  const stackRef = useRef<HTMLDivElement>(null);
  const exitTimers = useRef(new Map<number, number>());

  const toastsRef = useRef(toasts);
  useEffect(() => {
    toastsRef.current = toasts;
  });

  const dismiss = useCallback((id: number) => {
    const toast = toastsRef.current.find((t) => t.id === id);
    if (!toast || toast.leaving || exitTimers.current.has(id)) return;
    toast.onDismiss?.();
    setToasts((all) => all.map((t) => (t.id === id ? { ...t, leaving: true } : t)));
    exitTimers.current.set(id, window.setTimeout(() => {
      exitTimers.current.delete(id);
      setToasts((all) => all.filter((t) => t.id !== id));
    }, EXIT_MS));
  }, []);

  const notify = useCallback((input: ToastInput) => {
    const id = nextId.current++;
    // The same message twice in a row replaces the first one instead of stacking copies.
    setToasts((all) => [...all.filter((t) => !(t.message === input.message && t.type === input.type)), { ...input, id, leaving: false }].slice(-5));
    return id;
  }, []);

  useEffect(() => {
    const timers = exitTimers.current;
    return () => timers.forEach((t) => window.clearTimeout(t));
  }, []);

  // Keep the stack in the top layer, above any dialog opened after it.
  useEffect(() => {
    const stack = stackRef.current;
    if (!stack || typeof stack.showPopover !== "function") return;
    const raise = () => {
      if (!stack.isConnected) return;
      if (stack.matches(":popover-open")) stack.hidePopover();
      if (stack.childElementCount > 0) stack.showPopover();
    };
    raise();
    if (!toasts.length) return;
    const observer = new MutationObserver((records) => {
      if (records.some((r) => r.target instanceof HTMLDialogElement && r.target.open)) raise();
    });
    observer.observe(document.body, { subtree: true, attributes: true, attributeFilter: ["open"] });
    return () => observer.disconnect();
  }, [toasts.length]);

  const api = useMemo(() => ({ notify, dismiss }), [notify, dismiss]);
  return (
    <ToastContext.Provider value={api}>
      {children}
      <div ref={stackRef} className="toaster" popover="manual" aria-label="Notifications">
        {toasts.map((t) => (
          <ToastItem key={t.id} toast={t} onClose={dismiss} />
        ))}
      </div>
    </ToastContext.Provider>
  );
}

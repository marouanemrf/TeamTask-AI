import { useContext, useEffect, useRef } from "react";
import { ToastContext } from "../components/ui/toastContext";
import type { ToastApi, ToastType } from "../components/ui/toastContext";

const NO_TOASTS: ToastApi = { notify: () => 0, dismiss: () => undefined };

/** notify() / dismiss() for app-wide notifications (no-op outside the provider). */
export function useToast(): ToastApi {
  return useContext(ToastContext) ?? NO_TOASTS;
}

/**
 * Shows `message` as a notification each time it becomes a new non-empty value (e.g. an action
 * error or a "saved" notice kept in state). `onDismiss` runs when the notification goes away, so
 * the state can be cleared like the former inline "Dismiss" button did.
 */
export function useToastMessage(message: string | null | undefined, type: ToastType, onDismiss?: () => void) {
  const { notify } = useToast();
  const dismissRef = useRef(onDismiss);
  useEffect(() => {
    dismissRef.current = onDismiss;
  });
  useEffect(() => {
    if (!message) return;
    notify({ type, message, onDismiss: () => dismissRef.current?.() });
  }, [message, type, notify]);
}

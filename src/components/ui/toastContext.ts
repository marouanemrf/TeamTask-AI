import { createContext } from "react";

/** Notification API shared by the provider (Toaster.tsx) and useToast. */
export type ToastType = "success" | "error" | "warning" | "info";

export interface ToastInput {
  type: ToastType;
  message: string;
  title?: string;
  /** Called when the toast goes away (closed by the user or timed out). */
  onDismiss?: () => void;
}

export interface Toast extends ToastInput {
  id: number;
  leaving: boolean;
}

export interface ToastApi {
  notify: (toast: ToastInput) => number;
  dismiss: (id: number) => void;
}

export const ToastContext = createContext<ToastApi | null>(null);

import { useEffect, useId, useRef } from "react";
import type { FormEvent, ReactNode } from "react";
import { CloseIcon } from "./Icons";

export interface ModalProps {
  title: string;
  description?: ReactNode;
  children: ReactNode;
  /** Buttons shown in the footer. */
  footer?: ReactNode;
  onClose: () => void;
  /** While true, Escape and the close button do nothing (e.g. during a save). */
  busy?: boolean;
  /** When set, body + footer are wrapped in a <form> (submit buttons in the footer work). */
  onSubmit?: (event: FormEvent<HTMLFormElement>) => void;
  /** "drawer" slides in from the right, full height. */
  variant?: "dialog" | "drawer";
}

/**
 * Native modal <dialog>: focus is trapped inside, Escape closes, focus returns to the opener.
 * Opened on mount; the parent unmounts it to close.
 */
function Modal({ title, description, children, footer, onClose, busy = false, onSubmit, variant = "dialog" }: ModalProps) {
  const id = useId();
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const dialog = ref.current;
    dialog?.showModal();
    // Focus the first form control, else the dialog itself.
    const first = dialog?.querySelector<HTMLElement>("input:not([type=hidden]), select, textarea");
    (first ?? dialog)?.focus();
    return () => opener?.focus();
  }, []);

  const content = (
    <>
      <header className="modal__header">
        <div className="modal__heading">
          <h2 id={`${id}-title`} className="modal__title">
            {title}
          </h2>
          <button type="button" className="icon-button modal__close" onClick={() => !busy && onClose()} aria-label="Close">
            <CloseIcon />
          </button>
        </div>
        {description && <div className="modal__info">{description}</div>}
      </header>
      <div className="modal__scroll">
        <div className="modal__body">{children}</div>
      </div>
      {footer && <footer className="modal__footer">{footer}</footer>}
    </>
  );

  return (
    <dialog
      ref={ref}
      className={`modal${variant === "drawer" ? " modal--drawer" : ""}`}
      aria-labelledby={`${id}-title`}
      tabIndex={-1}
      onCancel={(event) => {
        event.preventDefault(); // Escape: close through React state, never mid-save
        if (!busy) onClose();
      }}
    >
      {onSubmit ? (
        <form className="modal__form" onSubmit={onSubmit} noValidate aria-busy={busy}>
          {content}
        </form>
      ) : (
        <div className="modal__form">{content}</div>
      )}
    </dialog>
  );
}

export default Modal;

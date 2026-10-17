import { useCallback, useEffect, useRef, useState } from "react";
import { primaryAssistantRole } from "../../../amplify/functions/shared/assistantAccess";
import { useUser } from "../../hooks/useUser";
import { OPEN_ASSISTANT_EVENT } from "../../utils/assistantEvents";
import type { AgentOrbState } from "./AgentOrb";
import AgentOrb3D from "./AgentOrb3D";
import AssistantPanel from "./AssistantPanel";

const PANEL_ID = "assistant-panel";

/**
 * Floating 3D orb (bottom-right, every authenticated page) that opens the TeamTask assistant.
 * The role shown is the user's highest Cognito group; the server applies it again on every tool call.
 */
function AssistantWidget() {
  const { roles } = useUser();
  const role = primaryAssistantRole(roles);
  const [open, setOpen] = useState(false);
  const [orbState, setOrbState] = useState<AgentOrbState>("idle");
  const buttonRef = useRef<HTMLButtonElement>(null);
  /** Where focus goes back on close: the orb, or e.g. the task drawer button that opened the panel. */
  const opener = useRef<HTMLElement | null>(null);

  const show = useCallback(() => {
    opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : buttonRef.current;
    setOpen(true);
  }, []);

  useEffect(() => {
    const onOpen = () => show();
    window.addEventListener(OPEN_ASSISTANT_EVENT, onOpen);
    return () => window.removeEventListener(OPEN_ASSISTANT_EVENT, onOpen);
  }, [show]);

  const close = useCallback(() => {
    setOpen(false);
    setOrbState("idle");
    // After the dialog has closed (the page is interactive again).
    requestAnimationFrame(() => (opener.current ?? buttonRef.current)?.focus());
  }, []);

  return (
    <>
      {open && <AssistantPanel id={PANEL_ID} role={role} onClose={close} onOrbState={setOrbState} />}
      <button
        ref={buttonRef}
        type="button"
        className={`assistant-launcher${open ? " assistant-launcher--open" : ""}`}
        aria-expanded={open}
        aria-controls={open ? PANEL_ID : undefined}
        aria-label={open ? "Close the TeamTask assistant" : "Open the TeamTask assistant"}
        onClick={() => (open ? close() : show())}
      >
        <AgentOrb3D state={orbState} size={56} />
        {!open && <span className="assistant-launcher__label" aria-hidden="true">Ask AI</span>}
      </button>
    </>
  );
}

export default AssistantWidget;

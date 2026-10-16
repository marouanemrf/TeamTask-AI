import { useEffect, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import { useProjects } from "../../hooks/useProjects";
import { ChatIcon, CloseIcon } from "../ui/Icons";
import AgentChatPanel from "./AgentChatPanel";

const PANEL_ID = "agent-chat-panel";

/**
 * Floating "AI assistant" button (managers) that opens the chat panel. The project open in the
 * page is preselected. Escape closes the panel and focus returns to the button.
 */
function AgentChatLauncher() {
  const [open, setOpen] = useState(false);
  const { projects } = useProjects();
  const { pathname } = useLocation();
  const buttonRef = useRef<HTMLButtonElement>(null);
  const currentProjectId = /^\/projects\/([^/]+)/.exec(pathname)?.[1];

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open]);

  function close() {
    setOpen(false);
    buttonRef.current?.focus();
  }

  return (
    <>
      {open && (
        <AgentChatPanel
          id={PANEL_ID}
          projects={projects}
          currentProjectId={currentProjectId && currentProjectId !== "new" ? decodeURIComponent(currentProjectId) : null}
          onClose={close}
        />
      )}
      <button
        ref={buttonRef}
        type="button"
        className={`agent-launcher${open ? " agent-launcher--open" : ""}`}
        aria-expanded={open}
        aria-controls={open ? PANEL_ID : undefined}
        aria-label={open ? "Close the AI assistant" : "Open the AI assistant"}
        onClick={() => (open ? close() : setOpen(true))}
      >
        {open ? <CloseIcon /> : <ChatIcon />}
      </button>
    </>
  );
}

export default AgentChatLauncher;

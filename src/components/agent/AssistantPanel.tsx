import { useEffect, useId, useRef, useState } from "react";
import { Link } from "react-router-dom";
import type { FormEvent, KeyboardEvent } from "react";
import { ACTIONS_BY_ROLE, ASSISTANT_TOOLS, ROLE_ACCESS_SUMMARY, TOOL_LABELS, TOOL_ROLES } from "../../../amplify/functions/shared/assistantAccess";
import type { AssistantRole } from "../../../amplify/functions/shared/assistantAccess";
import type { AssistantMessage, CardEntry } from "../../hooks/useAssistantChat";
import { useAssistantActions } from "../../hooks/useAssistantActions";
import { useAssistantChat } from "../../hooks/useAssistantChat";
import { useAssistantContext } from "../../hooks/useAssistantContext";
import { assistantApiUrl } from "../../services/assistantService";
import { ROLE_LABELS } from "../../utils/roles";
import { ROUTES } from "../../utils/routes";
import { CloseIcon, RefreshIcon, SendIcon, StopIcon } from "../ui/Icons";
import type { AgentOrbState } from "./AgentOrb";
import AgentOrb3D from "./AgentOrb3D";
import ExecutionDetails from "./ExecutionDetails";

const MANAGER_QUESTIONS = ["What are the risks on this project?", "Who is overloaded?", "Plan this project"];
const SUGGESTED: Record<AssistantRole, readonly string[]> = {
  VIEWER: ["How is the project going?", "Summary of the week"],
  MEMBER: ["What are my tasks this week?", "What is blocking my task?", "Report a blocker"],
  PROJECT_MANAGER: MANAGER_QUESTIONS,
  ADMIN: [...MANAGER_QUESTIONS, "Assistant activity", "Latest actions in the audit trail"],
};
const ACTION_LABELS: Record<string, string> = {
  CHANGE_MY_TASK_STATUS: "Change the status of my tasks",
  REPORT_BLOCKER: "Report a blocker on my tasks",
  ASSIGN_TASK: "Assign tasks",
  CHANGE_DUE_DATE: "Change due dates",
  START_PLANNING: "Start planning a project",
};

function ActionCardView({ entry, onConfirm, onCancel }: { entry: CardEntry; onConfirm: () => void; onCancel: () => void }) {
  const { card, state } = entry;
  return (
    <div className={`action-card action-card--${state}`} role="group" aria-label={`Proposed action: ${card.title}`}>
      <p className="action-card__title">{card.title}</p>
      <ul className="action-card__changes">
        {card.changes.map((c, i) => (
          <li key={i}>{c}</li>
        ))}
      </ul>
      {state === "pending" || state === "confirming" ? (
        <div className="action-card__buttons">
          <button type="button" className="button-secondary" onClick={onCancel} disabled={state === "confirming"}>
            Cancel
          </button>
          <button type="button" className="button-primary" onClick={onConfirm} disabled={state === "confirming"}>
            {state === "confirming" ? "Applying…" : "Confirm"}
          </button>
        </div>
      ) : (
        <p className={`action-card__result${state === "failed" ? " action-card__result--error" : ""}`} role={state === "failed" ? "alert" : "status"}>
          {state === "cancelled" ? "Cancelled. Nothing was changed." : entry.result}
        </p>
      )}
    </div>
  );
}

function AssistantBubble({ message, onRetry, onConfirm, onCancel }: {
  message: AssistantMessage;
  onRetry: () => void;
  onConfirm: (entry: CardEntry) => void;
  onCancel: (entry: CardEntry) => void;
}) {
  const streaming = message.status === "streaming";
  const execution = message.execution;
  const steps = execution?.steps.length ?? 0;
  return (
    <div className="chat-message chat-message--assistant">
      
      {message.text ? (
        <p className="chat-message__text">{message.text}</p>
      ) : streaming ? (
        <p className="chat-typing">
          <span className="visually-hidden">The assistant is thinking…</span>
          <span aria-hidden="true" />
          <span aria-hidden="true" />
          <span aria-hidden="true" />
        </p>
      ) : null}
      {message.cards.map((entry) => (
        <ActionCardView key={entry.id} entry={entry} onConfirm={() => onConfirm(entry)} onCancel={() => onCancel(entry)} />
      ))}
      {message.status === "stopped" && <p className="chat-message__meta">Stopped.</p>}
      {message.status === "error" && (
        <div className="chat-error" role="alert">
          <span>{message.error ?? "The assistant couldn't answer."}</span>
          <button type="button" className="button-secondary" onClick={onRetry}>
            Try again
          </button>
        </div>
      )}
    </div>
  );
}

export interface AssistantPanelProps {
  id: string;
  role: AssistantRole;
  onClose: () => void;
  onOrbState: (state: AgentOrbState) => void;
}

/**
 * The TeamTask assistant for every user. Answers come from tools that apply the user's role on
 * the server; changes come back as cards that run only after "Confirm", through the normal API.
 * Modal on every screen size: focus stays in the panel until it is closed.
 */
function AssistantPanel({ id, role, onClose, onOrbState }: AssistantPanelProps) {
  const uid = useId();
  const chat = useAssistantChat();
  const runAction = useAssistantActions();
  const { pageContext, label } = useAssistantContext();
  const [draft, setDraft] = useState("");
  const [typing, setTyping] = useState(false);
  const [showAccess, setShowAccess] = useState(false);
  const panelRef = useRef<HTMLDialogElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const logRef = useRef<HTMLDivElement>(null);
  const available = assistantApiUrl() !== null;
  const last = chat.messages[chat.messages.length - 1];

  const orbState: AgentOrbState = chat.busy
    ? "thinking"
    : last?.status === "error"
      ? "error"
      : chat.messages.some((m) => m.cards.some((c) => c.state === "pending"))
        ? "proposing"
        : typing
          ? "listening"
          : "idle";
  useEffect(() => onOrbState(orbState), [orbState, onOrbState]);
  // What the status pill says: from the real state of the conversation and the deployment.
  const status = !available
    ? { tone: "offline", label: "Offline", hint: "Not deployed in this environment" }
    : chat.busy
      ? { tone: "processing", label: "Processing", hint: "Working on your question…" }
      : last?.status === "error"
        ? { tone: "error", label: "Needs attention", hint: "The last answer failed" }
        : { tone: "available", label: "Available", hint: "Ready for your questions" };
  // A native modal dialog: above any other dialog (e.g. a task drawer), the rest of the page inert.
  useEffect(() => {
    const dialog = panelRef.current;
    if (dialog && !dialog.open) dialog.showModal();
    inputRef.current?.focus();
    return () => dialog?.close();
  }, []);
  useEffect(() => {
    const log = logRef.current;
    if (log) log.scrollTop = log.scrollHeight;
  }, [chat.messages]);

  function submit(event?: FormEvent) {
    event?.preventDefault();
    if (!draft.trim() || chat.busy) return;
    void chat.send(draft, pageContext);
    setDraft("");
    setTyping(false);
  }

  function onInputKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      submit();
    }
  }

  /** Escape closes the access popover first, then the panel (never a dialog underneath). */
  function escape() {
    if (showAccess) setShowAccess(false);
    else onClose();
  }

  /** Focus trap: Tab and Shift+Tab cycle inside the panel (the modal dialog already makes the page inert). */
  function onPanelKeyDown(event: KeyboardEvent<HTMLElement>) {
    if (event.key === "Escape") {
      event.preventDefault(); // handled here; no native "cancel" on top
      event.stopPropagation();
      escape();
      return;
    }
    if (event.key !== "Tab" || !panelRef.current) return;
    const focusable = Array.from(panelRef.current.querySelectorAll<HTMLElement>("button:not([disabled]), textarea:not([disabled]), summary, [tabindex='0'], a[href]")).filter((el) => el.offsetParent !== null);
    if (!focusable.length) return;
    const first = focusable[0];
    const lastEl = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      lastEl.focus();
    } else if (!event.shiftKey && document.activeElement === lastEl) {
      event.preventDefault();
      first.focus();
    }
  }

  async function confirm(messageId: string, entry: CardEntry) {
    chat.setCard(messageId, entry.id, "confirming");
    try {
      chat.setCard(messageId, entry.id, "done", await runAction(entry.card));
    } catch (err) {
      chat.setCard(messageId, entry.id, "failed", err instanceof Error ? err.message : "The change couldn't be applied.");
    }
  }

  return (
    <dialog ref={panelRef} id={id} className="assistant-panel" aria-labelledby={`${uid}-title`} onKeyDown={onPanelKeyDown} onCancel={(e) => {
        // Escape while focus is outside our handlers (e.g. after a suggestion button disappeared).
        e.preventDefault();
        escape();
      }}>
      <header className="assistant-panel__header">
        <span className="assistant-panel__avatar">
          <AgentOrb3D state={orbState} size={44} />
        </span>
        <div className="assistant-panel__heading">
          <h2 id={`${uid}-title`}>TeamTask Assistant</h2>
          <p className="assistant-panel__subtitle">AI help for your projects and tasks</p>
          <p className={`assistant-status assistant-status--${status.tone}`} aria-live="polite">
            <span className="assistant-status__dot" aria-hidden="true" />
            <span className="assistant-status__label">{status.label}</span>
            <span className="assistant-status__hint"> · {status.hint}</span>
          </p>
        </div>
        <div className="assistant-panel__tools">
          <button type="button" className="icon-button" onClick={chat.reset} aria-label="New conversation" title="New conversation" disabled={!chat.messages.length}>
            <RefreshIcon />
          </button>
          <button type="button" className="icon-button" onClick={onClose} aria-label="Close the assistant">
            <CloseIcon />
          </button>
        </div>
        <Link className="text-button assistant-panel__history" to={ROUTES.agentActivity} onClick={onClose}>
          Activity history
        </Link>
      </header>

      <div className="assistant-panel__access">
        <span className="badge badge--teal">{ROLE_LABELS[role]}</span>
        <p>
          <span className="visually-hidden">Your access: </span>
          {ROLE_ACCESS_SUMMARY[role]}
        </p>
        <button type="button" className="text-button" aria-expanded={showAccess} aria-controls={`${uid}-access`} onClick={() => setShowAccess((v) => !v)}>
          See my access
        </button>
        {showAccess && (
          <div id={`${uid}-access`} className="assistant-panel__matrix" role="region" aria-label="Your assistant access">
            <ul>
              {ASSISTANT_TOOLS.filter((t) => t !== "prepareAction").map((tool) => {
                const allowed = TOOL_ROLES[tool].includes(role);
                return (
                  <li key={tool} className={allowed ? "is-allowed" : "is-denied"}>
                    <span aria-hidden="true">{allowed ? "✓" : "✕"}</span> {TOOL_LABELS[tool]}
                    <span className="visually-hidden">{allowed ? ": allowed" : ": not available"}</span>
                  </li>
                );
              })}
            </ul>
            <p className="form-hint">
              Actions you can prepare (you always confirm):{" "}
              {ACTIONS_BY_ROLE[role].length ? ACTIONS_BY_ROLE[role].map((a) => ACTION_LABELS[a]).join(", ") : "none"}.
            </p>
          </div>
        )}
      </div>

      {label && (
        <p className="assistant-panel__context">
          <span className="chip">Context: {label}</span>
        </p>
      )}

      <div ref={logRef} className="assistant-panel__log" role="log" aria-live="polite" aria-relevant="additions text" tabIndex={0} aria-label="Conversation">
        {!available ? (
          <div className="agent-chat__empty agent-chat__welcome">
            <p className="agent-chat__welcome-title">Assistant offline</p>
            <p>The assistant isn't deployed in this environment yet.</p>
          </div>
        ) : chat.messages.length === 0 ? (
          <div className="agent-chat__empty agent-chat__welcome">
            <p className="agent-chat__welcome-title">How can I help?</p>
            <p>Ask about your projects and tasks. I answer from the data your role can see, and any change I prepare waits for your confirmation.</p>
            <p className="agent-chat__prompts-label">Try asking</p>
            <div className="agent-chat__prompts">
              {SUGGESTED[role].map((q) => (
                <button
                  key={q}
                  type="button"
                  className="chip-button"
                  onClick={() => {
                    void chat.send(q, pageContext);
                    inputRef.current?.focus(); // the suggestions disappear once the conversation starts
                  }}
                >
                  {q}
                </button>
              ))}
            </div>
          </div>
        ) : (
          chat.messages.map((m) =>
            m.role === "user" ? (
              <div key={m.id} className="chat-message chat-message--user">
                <p className="chat-message__text">{m.text}</p>
              </div>
            ) : (
              <AssistantBubble
                key={m.id}
                message={m}
                onRetry={() => chat.retry(pageContext)}
                onConfirm={(entry) => void confirm(m.id, entry)}
                onCancel={(entry) => chat.setCard(m.id, entry.id, "cancelled")}
              />
            ),
          )
        )}
      </div>

      <form className="agent-chat__composer" onSubmit={submit}>
        <label className="visually-hidden" htmlFor={`${uid}-input`}>
          Message to the assistant
        </label>
        <span id={`${uid}-hint`} className="visually-hidden">Enter sends the message; Shift and Enter add a new line.</span>
        <textarea
          id={`${uid}-input`}
          ref={inputRef}
          className="form-input agent-chat__input"
          rows={1}
          maxLength={2000}
          placeholder={available ? "Ask the assistant…" : "Not available yet"}
          value={draft}
          onChange={(e) => {
            setDraft(e.target.value);
            setTyping(e.target.value.length > 0);
          }}
          onBlur={() => setTyping(false)}
          onKeyDown={onInputKeyDown}
          aria-describedby={`${uid}-hint`}
          disabled={!available}
        />
        {chat.busy ? (
          <button type="button" className="agent-chat__send agent-chat__send--stop" onClick={chat.stop} aria-label="Stop the answer">
            <StopIcon />
            <span aria-hidden="true">Stop</span>
          </button>
        ) : (
          <button type="submit" className="agent-chat__send" aria-label="Send" disabled={!available || !draft.trim()}>
            <SendIcon />
            <span aria-hidden="true">Send</span>
          </button>
        )}
      </form>
    </dialog>
  );
}

export default AssistantPanel;

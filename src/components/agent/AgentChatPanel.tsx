import { useEffect, useId, useRef, useState } from "react";
import type { FormEvent, KeyboardEvent } from "react";
import type { Project } from "../../services/client";
import type { ChatMessage } from "../../hooks/useAgentChat";
import { useAgentChat } from "../../hooks/useAgentChat";
import { agentApiUrl } from "../../services/agentService";
import { CloseIcon, RefreshIcon, SendIcon, StopIcon } from "../ui/Icons";
import AgentOrb from "./AgentOrb";

const QUICK_PROMPTS: readonly string[] = [
  "Plan this project",
  "Suggest assignments",
  "Detect delivery risks",
  "Draft the weekly summary",
];

function AssistantMessage({ message, onRetry }: { message: ChatMessage; onRetry: () => void }) {
  const streaming = message.status === "streaming";
  return (
    <div className="chat-message chat-message--assistant">
      {message.trace.length > 0 && (
        <details className="chat-trace" open={streaming}>
          <summary>Reasoning ({message.trace.length} step{message.trace.length === 1 ? "" : "s"})</summary>
          <ol>
            {message.trace.map((t, i) => (
              <li key={`${t.step}-${i}`}>{t.label}</li>
            ))}
          </ol>
        </details>
      )}
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
      {message.recommendationId && (
        <p className="chat-recommendation">
          Plan submitted for approval. A manager reviews it before anything changes.
        </p>
      )}
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

export interface AgentChatPanelProps {
  id: string;
  projects: readonly Project[];
  /** Project the user is looking at, preselected. */
  currentProjectId: string | null;
  onClose: () => void;
}

/** Chat with the AI planning assistant about one project. It proposes; managers decide. */
function AgentChatPanel({ id, projects, currentProjectId, onClose }: AgentChatPanelProps) {
  const uid = useId();
  const openProjects = projects.filter((p) => p.status !== "CLOSED");
  const [projectId, setProjectId] = useState<string | null>(currentProjectId ?? openProjects[0]?.id ?? null);
  const { messages, busy, send, stop, retry, reset } = useAgentChat(projectId);
  const [draft, setDraft] = useState("");
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const logRef = useRef<HTMLDivElement>(null);
  const available = agentApiUrl() !== null;
  const last = messages[messages.length - 1];
  const orbState = busy ? "thinking" : last?.status === "error" ? "error" : "idle";

  useEffect(() => inputRef.current?.focus(), []);
  // Follow the conversation while it grows.
  useEffect(() => {
    const log = logRef.current;
    if (log) log.scrollTop = log.scrollHeight;
  }, [messages]);

  function submit(event?: FormEvent) {
    event?.preventDefault();
    if (!draft.trim() || busy) return;
    void send(draft);
    setDraft("");
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      submit();
    }
  }

  return (
    <section id={id} className="agent-chat" role="dialog" aria-modal="false" aria-labelledby={`${uid}-title`}>
      <header className="agent-chat__header">
        <AgentOrb state={orbState} size="sm" />
        <div className="agent-chat__heading">
          <h2 id={`${uid}-title`}>AI assistant</h2>
          <p className="agent-chat__status" aria-live="polite">
            {busy ? "Thinking…" : available ? "Planning help for your projects" : "Not deployed yet"}
          </p>
        </div>
        <button type="button" className="icon-button" onClick={reset} aria-label="New conversation" title="New conversation" disabled={!messages.length}>
          <RefreshIcon />
        </button>
        <button type="button" className="icon-button" onClick={onClose} aria-label="Close the assistant">
          <CloseIcon />
        </button>
      </header>

      <div className="agent-chat__context">
        <label className="form-field__label" htmlFor={`${uid}-project`}>
          Project
        </label>
        <select id={`${uid}-project`} className="form-input" value={projectId ?? ""} onChange={(e) => setProjectId(e.target.value || null)} disabled={busy}>
          {openProjects.length === 0 && <option value="">No open projects</option>}
          {openProjects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </div>

      <p className="agent-chat__banner">The AI proposes, the manager decides. Nothing is applied without approval.</p>

      <div ref={logRef} className="agent-chat__log" role="log" aria-live="polite" aria-relevant="additions text" tabIndex={0} aria-label="Conversation">
        {!available ? (
          <div className="agent-chat__empty">
            <p>The AI assistant isn't deployed in this environment yet.</p>
            <p className="text-muted">It becomes available once the Bedrock agent and the API are deployed.</p>
          </div>
        ) : messages.length === 0 ? (
          <div className="agent-chat__empty">
            <p>Ask about {openProjects.find((p) => p.id === projectId)?.name ?? "a project"}, or start with:</p>
            <div className="agent-chat__prompts">
              {QUICK_PROMPTS.map((prompt) => (
                <button key={prompt} type="button" className="chip-button" onClick={() => void send(prompt)} disabled={!projectId}>
                  {prompt}
                </button>
              ))}
            </div>
          </div>
        ) : (
          messages.map((m) =>
            m.role === "user" ? (
              <div key={m.id} className="chat-message chat-message--user">
                <p className="chat-message__text">{m.text}</p>
              </div>
            ) : (
              <AssistantMessage key={m.id} message={m} onRetry={retry} />
            ),
          )
        )}
      </div>

      <form className="agent-chat__composer" onSubmit={submit}>
        <label className="visually-hidden" htmlFor={`${uid}-input`}>
          Message to the assistant
        </label>
        <span id={`${uid}-input-hint`} className="visually-hidden">Enter sends the message; Shift and Enter add a new line.</span>
        <textarea
          id={`${uid}-input`}
          ref={inputRef}
          className="form-input agent-chat__input"
          rows={1}
          maxLength={2000}
          placeholder={available ? "Ask the assistant…" : "Not available yet"}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={onKeyDown}
          aria-describedby={`${uid}-input-hint`}
          disabled={!available || !projectId}
        />
        {busy ? (
          <button type="button" className="icon-button agent-chat__send" onClick={stop} aria-label="Stop the answer">
            <StopIcon />
          </button>
        ) : (
          <button type="submit" className="icon-button agent-chat__send" aria-label="Send" disabled={!available || !projectId || !draft.trim()}>
            <SendIcon />
          </button>
        )}
      </form>
    </section>
  );
}

export default AgentChatPanel;

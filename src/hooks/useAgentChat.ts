import { useCallback, useEffect, useRef, useState } from "react";
import { streamAgentPlan } from "../services/agentService";
import { describeApiError } from "../utils/apiErrors";

export interface TraceStep {
  step: string;
  label: string;
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  text: string;
  /** Tools the agent used while answering (sanitized trace). */
  trace: TraceStep[];
  /** Set when the answer produced a recommendation now waiting for approval. */
  recommendationId?: string;
  status: "streaming" | "done" | "stopped" | "error";
  error?: string;
}

const storageKey = (projectId: string) => `teamtask-agent-chat:${projectId}`;

interface StoredChat {
  sessionId: string;
  messages: ChatMessage[];
}

function load(projectId: string): StoredChat {
  try {
    const raw = sessionStorage.getItem(storageKey(projectId));
    if (raw) {
      const stored = JSON.parse(raw) as StoredChat;
      // A reload interrupts a streaming answer: show it as stopped.
      return { ...stored, messages: stored.messages.map((m) => (m.status === "streaming" ? { ...m, status: "stopped" } : m)) };
    }
  } catch {
    /* storage unavailable or corrupt: start over */
  }
  return { sessionId: crypto.randomUUID(), messages: [] };
}

function save(projectId: string, chat: StoredChat) {
  try {
    sessionStorage.setItem(storageKey(projectId), JSON.stringify(chat));
  } catch {
    /* storage unavailable: the chat lives for this page only */
  }
}

/**
 * One conversation with the AI planning assistant per project (kept for the browser tab). The
 * agent session id is stable per project so the agent keeps its context between messages.
 */
export function useAgentChat(projectId: string | null) {
  const [chat, setChat] = useState<StoredChat>(() => (projectId ? load(projectId) : { sessionId: "", messages: [] }));
  const [loadedFor, setLoadedFor] = useState(projectId);
  const abort = useRef<AbortController | null>(null);

  // Switching project shows that project's conversation.
  if (loadedFor !== projectId) {
    setLoadedFor(projectId);
    setChat(projectId ? load(projectId) : { sessionId: "", messages: [] });
  }

  useEffect(() => {
    if (projectId) save(projectId, chat);
  }, [projectId, chat]);

  useEffect(() => () => abort.current?.abort(), [projectId]);

  const busy = chat.messages.some((m) => m.status === "streaming");

  const updateMessage = (id: string, change: (m: ChatMessage) => ChatMessage) =>
    setChat((c) => ({ ...c, messages: c.messages.map((m) => (m.id === id ? change(m) : m)) }));

  const send = useCallback(
    async (text: string, replaceFrom?: number) => {
      const message = text.trim();
      if (!projectId || !message || busy) return;
      const answerId = crypto.randomUUID();
      setChat((c) => ({
        ...c,
        messages: [
          ...(replaceFrom === undefined ? c.messages : c.messages.slice(0, replaceFrom)),
          { id: crypto.randomUUID(), role: "user", text: message, trace: [], status: "done" },
          { id: answerId, role: "assistant", text: "", trace: [], status: "streaming" },
        ],
      }));
      const controller = new AbortController();
      abort.current = controller;
      try {
        await streamAgentPlan(
          projectId,
          message,
          chat.sessionId,
          (event) => {
            if (event.type === "chunk") updateMessage(answerId, (m) => ({ ...m, text: m.text + event.text }));
            else if (event.type === "trace") updateMessage(answerId, (m) => ({ ...m, trace: [...m.trace, { step: event.step, label: event.label }] }));
            else if (event.type === "recommendation") updateMessage(answerId, (m) => ({ ...m, recommendationId: event.recommendationId }));
            else if (event.type === "error") updateMessage(answerId, (m) => ({ ...m, status: "error", error: event.message }));
          },
          controller.signal,
        );
        updateMessage(answerId, (m) => (m.status === "streaming" ? { ...m, status: "done" } : m));
      } catch (err) {
        if (controller.signal.aborted) updateMessage(answerId, (m) => ({ ...m, status: "stopped" }));
        else updateMessage(answerId, (m) => ({ ...m, status: "error", error: describeApiError(err) }));
      } finally {
        if (abort.current === controller) abort.current = null;
      }
    },
    [projectId, busy, chat.sessionId],
  );

  const stop = useCallback(() => abort.current?.abort(), []);

  /** Asks the last question again, replacing the failed or stopped answer (no duplicate question). */
  const retry = useCallback(() => {
    const index = chat.messages.map((m) => m.role).lastIndexOf("user");
    if (index >= 0) void send(chat.messages[index].text, index);
  }, [chat.messages, send]);

  /** New conversation: the agent forgets the previous context too (new session id). */
  const reset = useCallback(() => {
    abort.current?.abort();
    setChat({ sessionId: crypto.randomUUID(), messages: [] });
  }, []);

  return { messages: chat.messages, busy, send, stop, retry, reset };
}

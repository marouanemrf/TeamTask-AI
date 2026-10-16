import { useCallback, useEffect, useRef, useState } from "react";
import { streamAssistantChat } from "../services/assistantService";
import type { ActionCard, PageContext } from "../services/assistantService";
import { describeApiError } from "../utils/apiErrors";

export type CardState = "pending" | "confirming" | "done" | "cancelled" | "failed";

export interface CardEntry {
  id: string;
  card: ActionCard;
  state: CardState;
  /** Result shown after confirming (success message or error). */
  result?: string;
}

export interface AssistantMessage {
  id: string;
  role: "user" | "assistant";
  text: string;
  trace: { step: string; label: string }[];
  cards: CardEntry[];
  status: "streaming" | "done" | "stopped" | "error";
  error?: string;
}

/**
 * The conversation with the TeamTask assistant, kept in memory for the browser session (the
 * widget lives in the app layout, so it survives navigation). "New conversation" also starts a new
 * agent memory on the server (new conversation id).
 */
export function useAssistantChat() {
  const [messages, setMessages] = useState<AssistantMessage[]>([]);
  const [conversationId, setConversationId] = useState(() => crypto.randomUUID());
  const abort = useRef<AbortController | null>(null);
  const busy = messages.some((m) => m.status === "streaming");

  useEffect(() => () => abort.current?.abort(), []);

  const update = (id: string, change: (m: AssistantMessage) => AssistantMessage) =>
    setMessages((all) => all.map((m) => (m.id === id ? change(m) : m)));

  const send = useCallback(
    async (text: string, pageContext: PageContext, replaceFrom?: number) => {
      const message = text.trim();
      if (!message || busy) return;
      const answerId = crypto.randomUUID();
      setMessages((all) => [
        ...(replaceFrom === undefined ? all : all.slice(0, replaceFrom)),
        { id: crypto.randomUUID(), role: "user", text: message, trace: [], cards: [], status: "done" },
        { id: answerId, role: "assistant", text: "", trace: [], cards: [], status: "streaming" },
      ]);
      const controller = new AbortController();
      abort.current = controller;
      try {
        await streamAssistantChat(
          { message, conversationId, pageContext },
          (event) => {
            if (event.type === "chunk") update(answerId, (m) => ({ ...m, text: m.text + event.text }));
            else if (event.type === "trace") update(answerId, (m) => ({ ...m, trace: [...m.trace, { step: event.step, label: event.label }] }));
            else if (event.type === "action") update(answerId, (m) => ({ ...m, cards: [...m.cards, { id: crypto.randomUUID(), card: event.card, state: "pending" }] }));
            else if (event.type === "error") update(answerId, (m) => ({ ...m, status: "error", error: event.message }));
          },
          controller.signal,
        );
        update(answerId, (m) => (m.status === "streaming" ? { ...m, status: "done" } : m));
      } catch (err) {
        if (controller.signal.aborted) update(answerId, (m) => ({ ...m, status: "stopped" }));
        else update(answerId, (m) => ({ ...m, status: "error", error: describeApiError(err) }));
      } finally {
        if (abort.current === controller) abort.current = null;
      }
    },
    [busy, conversationId],
  );

  const stop = useCallback(() => abort.current?.abort(), []);

  /** Asks the last question again, replacing the failed answer (no duplicate question). */
  const retry = useCallback(
    (pageContext: PageContext) => {
      const index = messages.map((m) => m.role).lastIndexOf("user");
      if (index >= 0) void send(messages[index].text, pageContext, index);
    },
    [messages, send],
  );

  const reset = useCallback(() => {
    abort.current?.abort();
    setMessages([]);
    setConversationId(crypto.randomUUID());
  }, []);

  const setCard = useCallback((messageId: string, cardId: string, state: CardState, result?: string) => {
    update(messageId, (m) => ({ ...m, cards: m.cards.map((c) => (c.id === cardId ? { ...c, state, result } : c)) }));
  }, []);

  return { messages, busy, send, stop, retry, reset, setCard };
}

import { useCallback, useEffect, useRef, useState } from "react";
import { streamAssistantChat } from "../services/assistantService";
import type { ActionCard, ExecutionStep, HistoryTurn, PageContext } from "../services/assistantService";
import { describeApiError } from "../utils/apiErrors";

export type CardState = "pending" | "confirming" | "done" | "cancelled" | "failed";

export interface CardEntry {
  id: string;
  card: ActionCard;
  state: CardState;
  /** Result shown after confirming (success message or error). */
  result?: string;
}

/** What the agent did for one answer, as reported by the server (observable steps, no hidden reasoning). */
export interface Execution {
  id: string | null;
  agent: string;
  /** The question this execution answered (kept in the browser only). */
  objective: string;
  status: "RUNNING" | "COMPLETED" | "FAILED" | "STOPPED";
  startedAt: string;
  durationMs?: number;
  steps: ExecutionStep[];
  guardrailInterventions: number;
}

export interface AssistantMessage {
  id: string;
  role: "user" | "assistant";
  text: string;
  /** Assistant answers only. */
  execution?: Execution;
  cards: CardEntry[];
  status: "streaming" | "done" | "stopped" | "error";
  error?: string;
}

/** Earlier turns sent with each question (the server keeps no conversation). */
const HISTORY_TURNS = 10;

/**
 * The conversation with the TeamTask assistant, kept in memory for the browser session only (the
 * widget lives in the app layout, so it survives navigation). Each question carries the last
 * answered turns as plain text; "New conversation" clears them.
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
      const history: HistoryTurn[] = (replaceFrom === undefined ? messages : messages.slice(0, replaceFrom))
        .filter((m) => m.status === "done" && m.text.trim())
        .slice(-HISTORY_TURNS)
        .map((m) => ({ role: m.role, text: m.text }));
      setMessages((all) => [
        ...(replaceFrom === undefined ? all : all.slice(0, replaceFrom)),
        { id: crypto.randomUUID(), role: "user", text: message, cards: [], status: "done" },
        {
          id: answerId,
          role: "assistant",
          text: "",
          cards: [],
          status: "streaming",
          execution: { id: null, agent: "TeamTask Assistant", objective: message, status: "RUNNING", startedAt: new Date().toISOString(), steps: [], guardrailInterventions: 0 },
        },
      ]);
      const controller = new AbortController();
      abort.current = controller;
      try {
        await streamAssistantChat(
          { message, conversationId, pageContext, history },
          (event) => {
            const exec = (change: (e: Execution) => Execution) => update(answerId, (m) => (m.execution ? { ...m, execution: change(m.execution) } : m));
            if (event.type === "chunk") update(answerId, (m) => ({ ...m, text: m.text + event.text }));
            else if (event.type === "execution") exec((e) => ({ ...e, id: event.executionId, agent: event.agent, startedAt: event.startedAt }));
            else if (event.type === "step")
              // A step arrives when the tool is called (RUNNING) and again with its outcome.
              exec((e) => {
                const i = e.steps.findIndex((s) => s.startedAt === event.step.startedAt && s.tool === event.step.tool);
                return { ...e, steps: i >= 0 ? e.steps.map((s, j) => (j === i ? event.step : s)) : [...e.steps, event.step] };
              });
            else if (event.type === "guardrail") exec((e) => ({ ...e, guardrailInterventions: e.guardrailInterventions + 1 }));
            else if (event.type === "done") exec((e) => ({ ...e, status: event.status, durationMs: event.durationMs }));
            else if (event.type === "action") update(answerId, (m) => ({ ...m, cards: [...m.cards, { id: crypto.randomUUID(), card: event.card, state: "pending" }] }));
            else if (event.type === "error") update(answerId, (m) => ({ ...m, status: "error", error: event.message }));
          },
          controller.signal,
        );
        update(answerId, (m) => (m.status === "streaming" ? { ...m, status: "done" } : m));
      } catch (err) {
        const close = (status: Execution["status"]) => (e?: Execution) => (e && e.status === "RUNNING" ? { ...e, status } : e);
        if (controller.signal.aborted) update(answerId, (m) => ({ ...m, status: "stopped", execution: close("STOPPED")(m.execution) }));
        else update(answerId, (m) => ({ ...m, status: "error", error: describeApiError(err), execution: close("FAILED")(m.execution) }));
      } finally {
        if (abort.current === controller) abort.current = null;
      }
    },
    [busy, conversationId, messages],
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

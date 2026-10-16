/** Opens the TeamTask assistant from anywhere (e.g. a task drawer, which makes the page behind it inert). */
export const OPEN_ASSISTANT_EVENT = "teamtask:open-assistant";

export function openAssistant(): void {
  window.dispatchEvent(new Event(OPEN_ASSISTANT_EVENT));
}

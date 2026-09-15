// Presentation-only helpers for the "Use your persona now" hand-off. These
// compose a ready-to-send message from the persona the engine already produced
// and deep-link into the AI the user picked. No scoring logic, no server call —
// the message goes straight to the chosen tool.

import type { ScoreResult } from "./types";

export type ChatTarget = {
  id: string;
  label: string;
  base: string | null;
  query: ((message: string) => string) | null;
};

// Web chat targets. Where a tool supports a prefill query param we deep-link
// with the message; otherwise we open the app and rely on the copied message.
export const CHAT_TARGETS: ChatTarget[] = [
  { id: "chatgpt", label: "ChatGPT", base: "https://chatgpt.com/", query: (m) => `https://chatgpt.com/?q=${encodeURIComponent(m)}` },
  { id: "claude", label: "Claude", base: "https://claude.ai/new", query: (m) => `https://claude.ai/new?q=${encodeURIComponent(m)}` },
  { id: "gemini", label: "Gemini", base: "https://gemini.google.com/app", query: null },
  { id: "any", label: "Any AI", base: null, query: null },
];

export function buildPrimedMessage(result: ScoreResult, task: string, personaName?: string): string {
  const label = personaName?.trim() || result.workstyle?.label || result.persona?.label || "my AI";
  const persona = result.persona;
  const rules = [
    ...(persona?.interaction_rules ?? []).slice(0, 2),
    ...(persona?.response_rules ?? []).slice(0, 1),
    ...(persona?.decision_rules ?? []).slice(0, 1),
  ].filter(Boolean);
  const ruleLines = rules.map((rule) => `- ${rule}`).join("\n");
  const preamble = `Please be my AI assistant and use my "${label}" style:\n${ruleLines}`;
  const request = task.trim() ? `\n\nMy request: ${task.trim()}` : "";
  return `${preamble}${request}`;
}

// Returns the URL to open, or null when we should only copy the message.
export function personaDeepLink(target: ChatTarget, message: string): string | null {
  if (target.query) {
    const url = target.query(message);
    // Keep well under browser URL limits; long messages fall back to copy+open.
    if (url.length <= 1900) return url;
    return target.base;
  }
  return target.base;
}

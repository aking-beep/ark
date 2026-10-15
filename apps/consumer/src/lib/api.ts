import type { InteractionEvent, Scenario, ScoreResult } from "./types";

export type FitFilterInput = { local_only?: boolean; max_pricing_tier?: string | null };

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
  if (!response.ok) {
    throw new Error(errorMessage(response.status, await response.text()));
  }
  return response.json() as Promise<T>;
}

/**
 * A sentence a person can act on, never a raw JSON body. When the scoring
 * service itself is down (502/504 from the proxy), local development also
 * gets the command that fixes the usual cause.
 */
export function errorMessage(status: number, body: string): string {
  if (status === 502 || status === 504) {
    const hint =
      process.env.NODE_ENV === "production"
        ? ""
        : " Running locally? Start everything with `npm run dev`; if the AI Fit API (port 8472) fails to start, run `npm run setup:my-ai` first.";
    return `AI Fit can't reach its scoring service right now. Try again in a moment.${hint}`;
  }
  if (status === 429) return "Too many requests in a short time. Wait a minute and try again.";
  try {
    const parsed = JSON.parse(body) as { error?: unknown; detail?: unknown };
    const text = typeof parsed.error === "string" ? parsed.error : typeof parsed.detail === "string" ? parsed.detail : "";
    if (text) return text;
  } catch {
    // Not JSON: fall through to the generic line.
  }
  return `Something went wrong (${status}). Try again in a moment.`;
}

export const api = {
  health: () => request<{ ok: boolean }>("/health"),
  scenarios: () => request<Scenario[]>("/v1/scenarios"),
  createSession: () => request<{ session_id: string }>("/v1/sessions", { method: "POST" }),
  demoSession: () =>
    request<{ session_id: string; session: { session_id: string; events: InteractionEvent[] }; result: ScoreResult }>(
      "/v1/sessions/demo",
      { method: "POST" },
    ),
  addEvents: (
    sessionId: string,
    body: {
      events: InteractionEvent[];
      free_text?: string;
      scenario_id: string;
      turn_id: string;
    },
  ) => request<{ event_count: number }>(`/v1/sessions/${sessionId}/events`, { method: "POST", body: JSON.stringify(body) }),
  score: (sessionId: string, filters?: FitFilterInput) =>
    request<ScoreResult>(`/v1/sessions/${sessionId}/score`, {
      method: "POST",
      body: JSON.stringify({ filters: filters ?? null }),
    }),
  scoreFull: (session: { session_id: string; events: InteractionEvent[] }, filters?: FitFilterInput) =>
    request<ScoreResult>("/v1/score", {
      method: "POST",
      body: JSON.stringify({ ...session, filters: filters ?? null }),
    }),
  signal: (session: { session_id: string; events: InteractionEvent[] }) =>
    request<{
      ready: boolean;
      next_scenario_id: string | null;
      confidence: number;
      scenarios_completed: number;
      note: string;
    }>("/v1/signal", { method: "POST", body: JSON.stringify(session) }),
  share: (sessionId: string) =>
    request<{ share_id: string; path: string; durable?: boolean }>(`/v1/sessions/${sessionId}/share`, { method: "POST" }),
  publishShare: (result: ScoreResult, sessionId?: string) =>
    request<{ share_id: string; path: string; durable?: boolean }>("/v1/share", {
      method: "POST",
      // session_id links the share to the session so deleting the session deletes the share.
      body: JSON.stringify(sessionId ? { result, session_id: sessionId } : { result }),
    }),
  getShare: (shareId: string) => request<ScoreResult>(`/v1/share/${shareId}`),
  exportSession: (sessionId: string) =>
    request<{ session: unknown; result: ScoreResult | null }>(`/v1/sessions/${sessionId}/export`),
  deleteSession: (sessionId: string) =>
    request<{ deleted: boolean }>(`/v1/sessions/${sessionId}`, { method: "DELETE" }),
  exportPersona: (target: string, result: ScoreResult) =>
    request<{ filename: string; content: string; encoding?: string }>(`/v1/export/${target}`, {
      method: "POST",
      body: JSON.stringify({ persona: result.persona, result }),
    }),
  products: () => request<Record<string, unknown>[]>("/v1/registry/products"),
  models: () => request<Record<string, unknown>[]>("/v1/registry/models"),
  freshness: () =>
    request<{
      needs_review: unknown[];
      products: unknown[];
      models: unknown[];
      last_reviewed?: string | null;
    }>("/v1/registry/freshness"),
  feedback: (body: { session_id?: string; share_id?: string; rating: number; comment: string; useful?: boolean }) =>
    request<{ ok: boolean }>("/v1/feedback", { method: "POST", body: JSON.stringify(body) }),
};

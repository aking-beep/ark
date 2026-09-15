import type { InteractionEvent, ScoreResult } from "./types";

const SESSION_PREFIX = "aifit:session:";
const RESULT_PREFIX = "aifit:result:";
const LAST_SESSION_KEY = "aifit:last-session";

export type StoredSession = {
  session_id: string;
  events: InteractionEvent[];
};

function browserStore(): Storage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    try {
      return window.sessionStorage;
    } catch {
      return null;
    }
  }
}

function readJson<T>(key: string): T | null {
  const store = browserStore();
  if (!store) return null;
  const raw = store.getItem(key);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

function writeJson(key: string, value: unknown) {
  const store = browserStore();
  if (!store) return;
  store.setItem(key, JSON.stringify(value));
}

function removeKey(key: string) {
  const store = browserStore();
  store?.removeItem(key);
}

export function saveSession(session: StoredSession) {
  writeJson(SESSION_PREFIX + session.session_id, session);
  writeJson(LAST_SESSION_KEY, session.session_id);
}

export function loadSession(sessionId: string): StoredSession | null {
  return readJson<StoredSession>(SESSION_PREFIX + sessionId);
}

export function saveResult(sessionId: string, result: ScoreResult) {
  writeJson(RESULT_PREFIX + sessionId, result);
  writeJson(LAST_SESSION_KEY, sessionId);
}

export function loadResult(sessionId: string): ScoreResult | null {
  return readJson<ScoreResult>(RESULT_PREFIX + sessionId);
}

export function lastSessionId(): string | null {
  const store = browserStore();
  return store?.getItem(LAST_SESSION_KEY) ?? null;
}

export function clearSession(sessionId: string) {
  removeKey(SESSION_PREFIX + sessionId);
  removeKey(RESULT_PREFIX + sessionId);
  const store = browserStore();
  if (store?.getItem(LAST_SESSION_KEY) === sessionId) {
    store.removeItem(LAST_SESSION_KEY);
  }
}

export async function encodeSharePayload(result: ScoreResult): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify(result));
  const compressed = await new Response(
    new Blob([bytes]).stream().pipeThrough(new CompressionStream("deflate-raw")),
  ).arrayBuffer();
  return btoa(String.fromCharCode(...new Uint8Array(compressed)))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
}

export async function decodeSharePayload(payload: string): Promise<ScoreResult | null> {
  try {
    const padded = payload.replaceAll("-", "+").replaceAll("_", "/");
    const binary = atob(padded);
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
    const json = await new Response(
      new Blob([bytes]).stream().pipeThrough(new DecompressionStream("deflate-raw")),
    ).text();
    return JSON.parse(json) as ScoreResult;
  } catch {
    return null;
  }
}

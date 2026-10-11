import type { InteractionEvent, ScoreResult } from "./types";

const SESSION_PREFIX = "aifit:session:";
const RESULT_PREFIX = "aifit:result:";
const LAST_SESSION_KEY = "aifit:last-session";

/** Share id for links whose snapshot lives only in the URL hash (never a session id). */
export const LOCAL_SHARE_ID = "local";
export const LOCAL_SHARE_PATH = `/share/${LOCAL_SHARE_ID}`;

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
  try {
    const raw = store.getItem(key);
    if (!raw) return null;
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

/** Best effort: quota errors (Safari private mode, full storage) must not break the quiz. */
function writeJson(key: string, value: unknown): boolean {
  const store = browserStore();
  if (!store) return false;
  try {
    store.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

function removeKey(key: string) {
  const store = browserStore();
  try {
    store?.removeItem(key);
  } catch {
    // Ignore storage failures.
  }
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
  try {
    return store?.getItem(LAST_SESSION_KEY) ?? null;
  } catch {
    return null;
  }
}

export function clearSession(sessionId: string) {
  removeKey(SESSION_PREFIX + sessionId);
  removeKey(RESULT_PREFIX + sessionId);
  if (lastSessionId() === sessionId) removeKey(LAST_SESSION_KEY);
}

/**
 * Base64url without spreading the whole buffer into String.fromCharCode, which
 * overflows the call stack for payloads above ~100 KB.
 */
export function bytesToBase64Url(bytes: Uint8Array): string {
  const CHUNK = 0x8000;
  let binary = "";
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

export function base64UrlToBytes(payload: string): Uint8Array<ArrayBuffer> {
  const binary = atob(payload.replaceAll("-", "+").replaceAll("_", "/"));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export async function encodeSharePayload(result: ScoreResult): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify(result));
  const compressed = await new Response(
    new Blob([bytes]).stream().pipeThrough(new CompressionStream("deflate-raw")),
  ).arrayBuffer();
  return bytesToBase64Url(new Uint8Array(compressed));
}

export async function decodeSharePayload(payload: string): Promise<ScoreResult | null> {
  try {
    const bytes = base64UrlToBytes(payload);
    const json = await new Response(
      new Blob([bytes]).stream().pipeThrough(new DecompressionStream("deflate-raw")),
    ).text();
    return JSON.parse(json) as ScoreResult;
  } catch {
    return null;
  }
}

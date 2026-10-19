import { afterEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import {
  LOCAL_SHARE_PATH,
  base64UrlToBytes,
  bytesToBase64Url,
  decodeSharePayload,
  encodeSharePayload,
  loadResult,
  saveResult,
  saveSession,
} from "./session-store.ts";
import type { ScoreResult } from "./types.ts";

const g = globalThis as { window?: unknown };

afterEach(() => {
  delete g.window;
});

function fakeStorage(opts: { throwOnSet?: boolean; throwOnGet?: boolean } = {}): Storage {
  const data = new Map<string, string>();
  return {
    get length() {
      return data.size;
    },
    clear: () => data.clear(),
    key: (i: number) => [...data.keys()][i] ?? null,
    getItem: (k: string) => {
      if (opts.throwOnGet) throw new Error("SecurityError");
      return data.get(k) ?? null;
    },
    setItem: (k: string, v: string) => {
      if (opts.throwOnSet) throw new Error("QuotaExceededError");
      data.set(k, v);
    },
    removeItem: (k: string) => {
      data.delete(k);
    },
  };
}

describe("session-store storage", { concurrency: 1 }, () => {
  test("a quota error on setItem does not throw", () => {
    g.window = { localStorage: fakeStorage({ throwOnSet: true }) };
    assert.doesNotThrow(() => saveSession({ session_id: "s1", events: [] }));
    assert.doesNotThrow(() => saveResult("s1", {} as ScoreResult));
    assert.equal(loadResult("s1"), null);
  });

  test("a throwing getItem reads as empty", () => {
    g.window = { localStorage: fakeStorage({ throwOnGet: true }) };
    assert.equal(loadResult("s1"), null);
  });

  test("round-trips when storage works", () => {
    g.window = { localStorage: fakeStorage() };
    saveResult("s2", { persona: { label: "x" } } as unknown as ScoreResult);
    assert.deepEqual(loadResult("s2"), { persona: { label: "x" } });
  });
});

describe("share payload encoding", () => {
  test("base64url handles buffers far larger than the call-stack limit", () => {
    const bytes = new Uint8Array(600_000);
    for (let i = 0; i < bytes.length; i += 1) bytes[i] = (i * 31) % 256;
    const encoded = bytesToBase64Url(bytes);
    assert.match(encoded, /^[A-Za-z0-9_-]+$/);
    assert.deepEqual(base64UrlToBytes(encoded), bytes);
  });

  test("large results survive encode/decode", async () => {
    const big = {
      persona: { label: "x" },
      instructions: Array.from({ length: 20_000 }, (_, i) => `line ${i} ${Math.sin(i)}`).join("\n"),
    } as unknown as ScoreResult;
    const encoded = await encodeSharePayload(big);
    assert.deepEqual(await decodeSharePayload(encoded), big);
  });

  test("the local share path never carries an id", () => {
    assert.equal(LOCAL_SHARE_PATH, "/share/local");
  });
});

import { afterEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import {
  buildUpstreamPath,
  downstreamResponseHeaders,
  myAiApiOrigin,
  proxyMyAiRequest,
  upstreamRequestHeaders,
} from "./my-ai-proxy.ts";

const original = {
  API_ORIGIN: process.env.API_ORIGIN,
  VERCEL: process.env.VERCEL,
};

afterEach(() => {
  if (original.API_ORIGIN === undefined) delete process.env.API_ORIGIN;
  else process.env.API_ORIGIN = original.API_ORIGIN;
  if (original.VERCEL === undefined) delete process.env.VERCEL;
  else process.env.VERCEL = original.VERCEL;
});

describe("myAiApiOrigin", { concurrency: 1 }, () => {
  test("uses API_ORIGIN when set, stripping a trailing slash", () => {
    process.env.API_ORIGIN = "http://my-ai.example:8472/";
    delete process.env.VERCEL;
    assert.equal(myAiApiOrigin(), "http://my-ai.example:8472");
  });

  test("returns null on Vercel so the platform rewrite owns /v1", () => {
    delete process.env.API_ORIGIN;
    process.env.VERCEL = "1";
    assert.equal(myAiApiOrigin(), null);
  });

  test("defaults to loopback MY AI API off Vercel", () => {
    delete process.env.API_ORIGIN;
    delete process.env.VERCEL;
    assert.equal(myAiApiOrigin(), "http://127.0.0.1:8472");
  });
});

describe("proxyMyAiRequest", { concurrency: 1 }, () => {
  test("returns 502 when no origin is configured", async () => {
    delete process.env.API_ORIGIN;
    process.env.VERCEL = "1";
    const res = await proxyMyAiRequest("/health", new Request("http://localhost/health"));
    assert.equal(res.status, 502);
    const body = (await res.json()) as { error: string };
    assert.match(body.error, /not configured/);
  });

  test("forwards method, path, and JSON body to the origin", async () => {
    process.env.API_ORIGIN = "http://my-ai.test";
    delete process.env.VERCEL;
    const calls: { url: string; method: string; body: string }[] = [];
    const fetchFn: typeof fetch = async (url, init) => {
      calls.push({
        url: String(url),
        method: String(init?.method),
        body: init?.body ? Buffer.from(init.body as ArrayBuffer).toString("utf8") : "",
      });
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    };
    const res = await proxyMyAiRequest(
      "/v1/sessions",
      new Request("http://localhost/v1/sessions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ demo: true }),
      }),
      { fetch: fetchFn },
    );
    assert.equal(res.status, 200);
    assert.equal(calls.length, 1);
    assert.equal(calls[0]!.url, "http://my-ai.test/v1/sessions");
    assert.equal(calls[0]!.method, "POST");
    assert.equal(calls[0]!.body, JSON.stringify({ demo: true }));
    assert.deepEqual(await res.json(), { ok: true });
  });

  test("returns 504 when the upstream fetch times out", async () => {
    process.env.API_ORIGIN = "http://my-ai.test";
    delete process.env.VERCEL;
    const fetchFn: typeof fetch = async () => {
      const err = new Error("aborted");
      err.name = "TimeoutError";
      throw err;
    };
    const res = await proxyMyAiRequest("/health", new Request("http://localhost/health"), {
      fetch: fetchFn,
    });
    assert.equal(res.status, 504);
    const body = (await res.json()) as { error: string };
    assert.match(body.error, /timed out/);
  });

  test("returns 502 when the upstream fetch fails", async () => {
    process.env.API_ORIGIN = "http://my-ai.test";
    delete process.env.VERCEL;
    const fetchFn: typeof fetch = async () => {
      throw new Error("ECONNREFUSED");
    };
    const res = await proxyMyAiRequest("/health", new Request("http://localhost/health"), {
      fetch: fetchFn,
    });
    assert.equal(res.status, 502);
    const body = (await res.json()) as { error: string };
    assert.match(body.error, /unreachable/);
  });
});

describe("buildUpstreamPath", () => {
  test("re-encodes each decoded segment so it cannot add path or query parts", () => {
    assert.equal(buildUpstreamPath(["sessions", "abc"]), "/v1/sessions/abc");
    assert.equal(buildUpstreamPath(["share", "a?b=c"]), "/v1/share/a%3Fb%3Dc");
    assert.equal(buildUpstreamPath(["share", "a#b"]), "/v1/share/a%23b");
    assert.equal(buildUpstreamPath(["share", "%2e%2e"]), "/v1/share/%252e%252e");
    assert.equal(buildUpstreamPath(["share", "x y"]), "/v1/share/x%20y");
  });

  test("keeps the original query string", () => {
    assert.equal(buildUpstreamPath(["registry", "products"], "?a=1&b=2"), "/v1/registry/products?a=1&b=2");
    assert.equal(buildUpstreamPath(["registry", "products"], "?"), "/v1/registry/products");
  });

  test("rejects dot, empty, separator, and control segments", () => {
    for (const bad of [[], ["."], [".."], ["sessions", ".."], ["sessions", ""], ["a/b"], ["a\\b"], ["a\u0000"], ["..", "health"]]) {
      assert.equal(buildUpstreamPath(bad), null, JSON.stringify(bad));
    }
  });
});

describe("header filtering", () => {
  test("forwards only the allow-list plus the nearest client IP", () => {
    const incoming = new Headers({
      "content-type": "application/json",
      accept: "application/json",
      "accept-language": "en",
      "user-agent": "test",
      "accept-encoding": "gzip, br",
      cookie: "session=secret",
      authorization: "Bearer x",
      host: "evil.example",
      "x-forwarded-for": "198.51.100.1, 203.0.113.9",
      "x-custom": "1",
    });
    const out = upstreamRequestHeaders(incoming);
    const names = [...out.keys()].sort();
    assert.deepEqual(names, ["accept", "accept-language", "content-type", "user-agent", "x-forwarded-for"]);
    assert.equal(out.get("x-forwarded-for"), "203.0.113.9");
  });

  test("drops a malformed forwarded-for value", () => {
    const out = upstreamRequestHeaders(new Headers({ "x-forwarded-for": "not an ip<script>" }));
    assert.equal(out.get("x-forwarded-for"), null);
  });

  test("strips encoding, length, cookies, and hop-by-hop headers from responses", () => {
    const out = downstreamResponseHeaders(
      new Headers({
        "content-type": "application/json",
        "content-encoding": "gzip",
        "content-length": "10",
        "transfer-encoding": "chunked",
        "set-cookie": "a=b",
        "cache-control": "no-store",
      }),
    );
    assert.deepEqual([...out.keys()].sort(), ["cache-control", "content-type"]);
  });
});

describe("proxyMyAiRequest hardening", { concurrency: 1 }, () => {
  test("does not forward accept-encoding or cookies upstream, and strips content-encoding back", async () => {
    process.env.API_ORIGIN = "http://my-ai.test";
    delete process.env.VERCEL;
    let seen: Headers | null = null;
    const fetchFn: typeof fetch = async (_url, init) => {
      seen = new Headers(init?.headers);
      return new Response("{}", {
        status: 200,
        headers: { "content-type": "application/json", "content-encoding": "gzip", "content-length": "99" },
      });
    };
    const res = await proxyMyAiRequest(
      "/v1/scenarios",
      new Request("http://localhost/v1/scenarios", {
        headers: { "accept-encoding": "gzip", cookie: "x=1", accept: "application/json" },
      }),
      { fetch: fetchFn },
    );
    assert.equal(res.status, 200);
    assert.equal(seen!.get("accept-encoding"), null);
    assert.equal(seen!.get("cookie"), null);
    assert.equal(seen!.get("accept"), "application/json");
    assert.equal(res.headers.get("content-encoding"), null);
    assert.equal(res.headers.get("content-length"), null);
  });

  test("refuses bodies over the cap by content-length and by streamed size", async () => {
    process.env.API_ORIGIN = "http://my-ai.test";
    delete process.env.VERCEL;
    let calls = 0;
    const fetchFn: typeof fetch = async () => {
      calls += 1;
      return new Response("{}");
    };
    const declared = await proxyMyAiRequest(
      "/v1/share",
      new Request("http://localhost/v1/share", {
        method: "POST",
        headers: { "content-length": String(2 * 1024 * 1024) },
        body: "x",
      }),
      { fetch: fetchFn },
    );
    assert.equal(declared.status, 413);

    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        for (let i = 0; i < 20; i += 1) controller.enqueue(new Uint8Array(64 * 1024));
        controller.close();
      },
    });
    const streamed = await proxyMyAiRequest(
      "/v1/share",
      new Request("http://localhost/v1/share", { method: "POST", body: stream, duplex: "half" } as RequestInit),
      { fetch: fetchFn },
    );
    assert.equal(streamed.status, 413);
    assert.equal(calls, 0);
  });
});

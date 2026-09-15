import { afterEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import { fitApiOrigin, proxyFitRequest } from "./fit-proxy.ts";

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

describe("fitApiOrigin", { concurrency: 1 }, () => {
  test("uses API_ORIGIN when set, stripping a trailing slash", () => {
    process.env.API_ORIGIN = "http://fit.example:8472/";
    delete process.env.VERCEL;
    assert.equal(fitApiOrigin(), "http://fit.example:8472");
  });

  test("returns null on Vercel so the platform rewrite owns /v1", () => {
    delete process.env.API_ORIGIN;
    process.env.VERCEL = "1";
    assert.equal(fitApiOrigin(), null);
  });

  test("defaults to loopback Fit API off Vercel", () => {
    delete process.env.API_ORIGIN;
    delete process.env.VERCEL;
    assert.equal(fitApiOrigin(), "http://127.0.0.1:8472");
  });
});

describe("proxyFitRequest", { concurrency: 1 }, () => {
  test("returns 502 when no origin is configured", async () => {
    delete process.env.API_ORIGIN;
    process.env.VERCEL = "1";
    const res = await proxyFitRequest("/health", new Request("http://localhost/health"));
    assert.equal(res.status, 502);
    const body = (await res.json()) as { error: string };
    assert.match(body.error, /not configured/);
  });

  test("forwards method, path, and JSON body to the origin", async () => {
    process.env.API_ORIGIN = "http://fit.test";
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
    const res = await proxyFitRequest(
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
    assert.equal(calls[0]!.url, "http://fit.test/v1/sessions");
    assert.equal(calls[0]!.method, "POST");
    assert.equal(calls[0]!.body, JSON.stringify({ demo: true }));
    assert.deepEqual(await res.json(), { ok: true });
  });

  test("returns 504 when the upstream fetch times out", async () => {
    process.env.API_ORIGIN = "http://fit.test";
    delete process.env.VERCEL;
    const fetchFn: typeof fetch = async () => {
      const err = new Error("aborted");
      err.name = "TimeoutError";
      throw err;
    };
    const res = await proxyFitRequest("/health", new Request("http://localhost/health"), {
      fetch: fetchFn,
    });
    assert.equal(res.status, 504);
    const body = (await res.json()) as { error: string };
    assert.match(body.error, /timed out/);
  });

  test("returns 502 when the upstream fetch fails", async () => {
    process.env.API_ORIGIN = "http://fit.test";
    delete process.env.VERCEL;
    const fetchFn: typeof fetch = async () => {
      throw new Error("ECONNREFUSED");
    };
    const res = await proxyFitRequest("/health", new Request("http://localhost/health"), {
      fetch: fetchFn,
    });
    assert.equal(res.status, 502);
    const body = (await res.json()) as { error: string };
    assert.match(body.error, /unreachable/);
  });
});

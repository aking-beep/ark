import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  readBodyCapped, tooManyEvents, sameOrigin, clientIp, RateLimiter, parseDays, MAX_EVENTS_PER_BATCH,
} from './guards.ts';
import { resolveSessionSecret, showDemoLogin } from './config.ts';
import { discoverErrorMessage, discoverErrorCode, isPublicRepo, privateDiscoveryAllowed, DISCOVER_ERRORS } from './discover.ts';

const headers = (h: Record<string, string>) => new Headers(h);

function streamOf(chunks: string[]): ReadableStream<Uint8Array> {
  const enc = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const c of chunks) controller.enqueue(enc.encode(c));
      controller.close();
    },
  });
}

describe('readBodyCapped', () => {
  test('reads a body under the cap', async () => {
    const r = await readBodyCapped({ headers: headers({}), body: streamOf(['{"a":', '1}']) }, 100);
    assert.deepEqual(r, { ok: true, text: '{"a":1}' });
  });

  test('refuses on Content-Length before reading', async () => {
    const r = await readBodyCapped({ headers: headers({ 'content-length': '101' }), body: streamOf(['x']) }, 100);
    assert.equal(r.ok, false);
    assert.equal(!r.ok && r.status, 413);
  });

  test('refuses a stream that exceeds the cap with no or a lying Content-Length', async () => {
    const big = ['x'.repeat(60), 'x'.repeat(60)];
    const none = await readBodyCapped({ headers: headers({}), body: streamOf(big) }, 100);
    assert.equal(!none.ok && none.status, 413);
    const lying = await readBodyCapped({ headers: headers({ 'content-length': '10' }), body: streamOf(big) }, 100);
    assert.equal(!lying.ok && lying.status, 413);
  });

  test('a malformed Content-Length is a 400', async () => {
    const r = await readBodyCapped({ headers: headers({ 'content-length': 'abc' }), body: null }, 100);
    assert.equal(!r.ok && r.status, 400);
  });
});

describe('tooManyEvents', () => {
  test('caps the events array before parsing', () => {
    assert.equal(tooManyEvents({ events: new Array(MAX_EVENTS_PER_BATCH).fill({}) }), false);
    assert.equal(tooManyEvents({ events: new Array(MAX_EVENTS_PER_BATCH + 1).fill({}) }), true);
    assert.equal(tooManyEvents(null), false);
    assert.equal(tooManyEvents({ events: 'nope' }), false);
  });
});

describe('sameOrigin', () => {
  test('accepts a matching Origin and refuses another site', () => {
    assert.equal(sameOrigin(headers({ host: 'localhost:3002', origin: 'http://localhost:3002' })), true);
    assert.equal(sameOrigin(headers({ host: 'localhost:3002', origin: 'https://evil.example' })), false);
    assert.equal(sameOrigin(headers({ host: 'localhost:3002', origin: 'null' })), false);
  });

  test('uses X-Forwarded-Host behind a proxy, and honours an explicit allow-list', () => {
    assert.equal(sameOrigin(headers({ host: '10.0.0.5:3002', 'x-forwarded-host': 'ark.example', origin: 'https://ark.example' })), true);
    assert.equal(sameOrigin(headers({ host: '10.0.0.5:3002', origin: 'https://ark.example' }), ['https://ark.example/']), true);
  });

  test('no Origin: allowed unless Sec-Fetch-Site says cross-site', () => {
    assert.equal(sameOrigin(headers({ host: 'localhost:3002' })), true);
    assert.equal(sameOrigin(headers({ host: 'localhost:3002', 'sec-fetch-site': 'cross-site' })), false);
    assert.equal(sameOrigin(headers({ host: 'localhost:3002', 'sec-fetch-site': 'same-origin' })), true);
  });
});

describe('RateLimiter', () => {
  test('allows the limit, refuses the next, and resets after the window', () => {
    const rl = new RateLimiter(3, 60_000);
    const t = 1_000_000;
    for (let i = 0; i < 3; i++) assert.equal(rl.take('ip|a@x', t).allowed, true);
    const refused = rl.take('ip|a@x', t + 1);
    assert.equal(refused.allowed, false);
    assert.ok(refused.retryAfterSec >= 1);
    assert.equal(rl.take('ip|b@x', t + 1).allowed, true, 'keys are independent');
    assert.equal(rl.take('ip|a@x', t + 60_001).allowed, true);
  });

  test('stays bounded in memory', () => {
    const rl = new RateLimiter(1, 60_000, 10);
    for (let i = 0; i < 100; i++) rl.take(`k${i}`, 1);
    assert.ok((rl as unknown as { hits: Map<string, unknown> }).hits.size <= 10);
  });

  test('clientIp takes the right-most hop, the one a client cannot write', () => {
    // A client-supplied entry sits on the left; the nearest proxy (or Next's own
    // socket address) is on the right.
    assert.equal(clientIp(headers({ 'x-forwarded-for': '203.0.113.9, 10.0.0.1' })), '10.0.0.1');
    process.env.ARK_TRUSTED_PROXY_HOPS = '2';
    try {
      assert.equal(clientIp(headers({ 'x-forwarded-for': '6.6.6.6, 203.0.113.9, 10.0.0.1' })), '203.0.113.9');
    } finally {
      delete process.env.ARK_TRUSTED_PROXY_HOPS;
    }
    assert.equal(clientIp(headers({ 'x-real-ip': '198.51.100.2' })), '198.51.100.2');
    assert.equal(clientIp(headers({})), 'unknown');
  });
});

describe('parseDays', () => {
  test('integers in 1..365, default on garbage', () => {
    assert.equal(parseDays(null, 30), 30);
    assert.equal(parseDays('', 30), 30);
    assert.equal(parseDays('abc', 30), 30);
    assert.equal(parseDays('7', 30), 7);
    assert.equal(parseDays('7.9', 30), 30);
    assert.equal(parseDays('1e3', 30), 30);
    assert.equal(parseDays('30abc', 30), 30);
    assert.equal(parseDays('0', 30), 1);
    assert.equal(parseDays('-5', 30), 1);
    assert.equal(parseDays('100000', 30), 365);
    assert.equal(parseDays('Infinity', 30), 30);
    assert.equal(parseDays(null, Number.NaN), 30);
  });
});

describe('resolveSessionSecret', () => {
  const strong = 'k'.repeat(32);
  test('development falls back to the dev secret', () => {
    assert.equal(resolveSessionSecret({ NODE_ENV: 'development' }), 'dev-insecure-session-secret');
    assert.equal(resolveSessionSecret({ ARK_SESSION_SECRET: 'short' }), 'short');
  });

  test('production refuses empty, published and short secrets', () => {
    for (const ARK_SESSION_SECRET of [undefined, '', '   ', 'change-me-in-production', 'dev-insecure-session-secret', 'k'.repeat(31)]) {
      assert.throws(() => resolveSessionSecret({ NODE_ENV: 'production', ARK_SESSION_SECRET }), /ARK_SESSION_SECRET/);
    }
    assert.equal(resolveSessionSecret({ NODE_ENV: 'production', ARK_SESSION_SECRET: strong }), strong);
  });
});

describe('showDemoLogin', () => {
  test('on outside production, off in production unless opted in', () => {
    assert.equal(showDemoLogin({ NODE_ENV: 'development' }), true);
    assert.equal(showDemoLogin({ NODE_ENV: 'production' }), false);
    assert.equal(showDemoLogin({ NODE_ENV: 'production', ARK_SHOW_DEMO_LOGIN: '1' }), true);
    assert.equal(showDemoLogin({ NODE_ENV: 'production', ARK_SHOW_DEMO_LOGIN: 'true' }), false);
  });
});

describe('discover', () => {
  test('error codes map to fixed copy and arbitrary text is never echoed', () => {
    assert.equal(discoverErrorMessage(undefined), null);
    assert.equal(discoverErrorMessage('bad_url'), DISCOVER_ERRORS.bad_url);
    assert.equal(discoverErrorMessage('<script>alert(1)</script>'), DISCOVER_ERRORS.failed);
    assert.equal(discoverErrorMessage('toString'), DISCOVER_ERRORS.failed);
  });

  test('fetch errors classify into codes', () => {
    assert.equal(discoverErrorCode(new Error('Repository not found or not visible.')), 'not_found');
    assert.equal(discoverErrorCode(new Error('GitHub refused the request.')), 'refused');
    assert.equal(discoverErrorCode(new Error('GitHub fetch exceeded the overall time budget.')), 'timeout');
    assert.equal(discoverErrorCode(new Error('weird internal detail https://x/?token=abc')), 'failed');
  });

  const fakeFetch = (status: number, json: unknown, seen: RequestInit[] = []) =>
    (async (_url: string | URL | Request, init?: RequestInit) => {
      seen.push(init ?? {});
      return new Response(JSON.stringify(json), { status });
    }) as typeof fetch;

  test('isPublicRepo trusts only an anonymous private:false', async () => {
    const seen: RequestInit[] = [];
    assert.equal(await isPublicRepo('o', 'r', fakeFetch(200, { private: false, visibility: 'public' }, seen)), true);
    const sent = new Headers(seen[0]!.headers);
    assert.equal(sent.get('authorization'), null, 'the check never carries the server token');
    assert.equal(await isPublicRepo('o', 'r', fakeFetch(200, { private: true })), false);
    assert.equal(await isPublicRepo('o', 'r', fakeFetch(200, {})), false);
    assert.equal(await isPublicRepo('o', 'r', fakeFetch(404, { message: 'Not Found' })), false);
    assert.equal(await isPublicRepo('o', 'r', (async () => { throw new Error('net'); }) as typeof fetch), false);
  });

  test('private discovery is opt-in', () => {
    assert.equal(privateDiscoveryAllowed({}), false);
    assert.equal(privateDiscoveryAllowed({ ARK_DISCOVER_ALLOW_PRIVATE: '1' }), true);
  });
});

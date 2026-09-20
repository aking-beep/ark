#!/usr/bin/env node
/**
 * Before/after probe for suite-competitive-loop.
 *
 * Same command twice. Everything that does not exist yet prints ABSENT.
 * Requires: npm run build:packages (for SDK checks). HTTP checks tolerate down servers.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const out = [];
const line = (k, v) => out.push(`${k.padEnd(48)} ${v}`);
const ABSENT = 'ABSENT';
const DIR = 'evidence/suite-competitive-loop';
mkdirSync(DIR, { recursive: true });

async function tryImport(spec) {
  try {
    return await import(spec);
  } catch {
    return null;
  }
}

async function get(url) {
  try {
    const res = await fetch(url, { redirect: 'manual' });
    const body = await res.text().catch(() => '');
    return { status: res.status, body };
  } catch (err) {
    return { status: 0, body: String(err) };
  }
}

const sdk = await tryImport('@ark/sdk');
line('@ark/sdk resolves', sdk ? 'yes' : ABSENT);
line('sdk exports instrumentFetch', typeof sdk?.ArkIngest?.prototype?.instrumentFetch === 'function' ? 'yes' : ABSENT);
line('sdk exports run', typeof sdk?.ArkIngest?.prototype?.run === 'function' ? 'yes' : ABSENT);

/* -------------------------------------------------------------- wrap behaviour */
let wrapTwoTurns = ABSENT;
let wrapNoBody = ABSENT;
let wrapNoControlUrl = ABSENT;
let wrapOutsideRun = ABSENT;

if (typeof sdk?.ArkIngest?.prototype?.instrumentFetch === 'function' && typeof sdk?.ArkIngest?.prototype?.run === 'function') {
  const ingestPosts = [];
  const llmCalls = [];
  const innerFetch = async (url, init) => {
    const href = String(url);
    if (href.includes('/api/v1/events')) {
      ingestPosts.push(JSON.parse(String(init?.body)));
      return new Response(JSON.stringify({
        accepted: 2, tracesClosed: 1, priced: 2, unpriced: 0, alerts: 0, circuitBreaks: [],
      }), { status: 202 });
    }
    llmCalls.push({ href, body: String(init?.body ?? '') });
    return new Response(JSON.stringify({
      id: 'chatcmpl_1',
      model: 'gpt-4.1-mini',
      usage: { prompt_tokens: 11, completion_tokens: 5, prompt_tokens_details: { cached_tokens: 0 } },
      choices: [{ message: { role: 'assistant', content: 'hello ada@example.com' } }],
    }), { status: 200, headers: { 'content-type': 'application/json' } });
  };

  const client = new sdk.ArkIngest({
    baseUrl: 'http://control.test',
    token: 'ark_test',
    fetch: innerFetch,
  });
  const wrapped = client.instrumentFetch(innerFetch);

  await client.run('wl_probe', async () => {
    await wrapped('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      body: JSON.stringify({
        model: 'gpt-4.1-mini',
        messages: [{ role: 'user', content: 'secret prompt ada@example.com' }],
      }),
    });
    await wrapped('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      body: JSON.stringify({ model: 'gpt-4.1-mini', messages: [{ role: 'user', content: 'turn two' }] }),
    });
  });

  const events = ingestPosts.flatMap((p) => p.events ?? []);
  wrapTwoTurns = events.length === 2 && events[0].traceId === events[1].traceId && events[0].turn === 0 && events[1].turn === 1
    ? `yes (${events[0].traceId} turns ${events.map((e) => e.turn).join(',')})`
    : `no (${events.length} events)`;

  const serialised = JSON.stringify(ingestPosts);
  wrapNoBody = serialised.includes('secret prompt') || serialised.includes('ada@example.com')
    ? 'LEAKS'
    : 'yes';

  await wrapped('http://control.test/api/v1/events', {
    method: 'POST',
    body: JSON.stringify({ events: [] }),
  });
  wrapNoControlUrl = ingestPosts.some((p) => (p.events ?? []).some((e) => String(e.modelId ?? '').includes('events')))
    ? 'RECORDED CONTROL'
    : 'yes';

  const before = ingestPosts.length;
  await wrapped('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    body: JSON.stringify({ model: 'gpt-4.1-mini', messages: [] }),
  });
  wrapOutsideRun = ingestPosts.length === before ? 'yes' : 'INVENTED TRACE';
}

line('wrap: two turns one trace', wrapTwoTurns);
line('wrap: no prompt body in ingest', wrapNoBody);
line('wrap: Control URL is not a model call', wrapNoControlUrl);
line('wrap: outside run() is a no-op', wrapOutsideRun);

/* ---------------------------------------------------------------- HTTP pages */
const consumer = await get('http://localhost:3000/');
const teams = await get('http://localhost:3001/');

let start = { status: 0, body: '' };
try {
  const login = await fetch('http://localhost:3002/api/session', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'sam@northwind.example', password: 'northwind-demo' }),
    redirect: 'manual',
  });
  const cookie = login.headers.get('set-cookie') ?? '';
  const token = /ark_session=([^;]+)/.exec(cookie)?.[1];
  if (token) {
    const res = await fetch('http://localhost:3002/start', { headers: { cookie: `ark_session=${token}` }, redirect: 'manual' });
    start = { status: res.status, body: await res.text() };
  } else {
    start = await get('http://localhost:3002/start');
  }
} catch (err) {
  start = { status: 0, body: String(err) };
}

line('GET :3000/ status', String(consumer.status || ABSENT));
line('consumer names CLAUDE.md', consumer.body.includes('CLAUDE.md') ? 'yes' : ABSENT);
line('consumer has For teams', /for teams/i.test(consumer.body) ? 'LEAK' : 'no');

line('GET :3001/ status', String(teams.status || ABSENT));
line('teams shows Assess loop', teams.body.includes('Assess → Measure → Control') ? 'yes' : ABSENT);
line('teams has Open MY AI', /open my ai|not at work\?/i.test(teams.body) ? 'LEAK' : 'no');

line('GET :3002/start status', start.status === 0 ? ABSENT : String(start.status));
line('/start names instrumentFetch', start.body.includes('instrumentFetch') ? 'yes' : ABSENT);
line('/start prints a bearer secret', /ark_dev_ingest/.test(start.body) ? 'LEAK' : 'no');

/* ---------------------------------------------------------------- docs */
const { existsSync } = await import('node:fs');
line('docs/08-how-ark-works.md', existsSync('docs/08-how-ark-works.md') ? 'yes' : ABSENT);

writeFileSync(path.join(DIR, 'last-probe.txt'), out.join('\n') + '\n');
writeFileSync(path.join(DIR, 'consumer.html'), consumer.body.slice(0, 80_000));
writeFileSync(path.join(DIR, 'teams.html'), teams.body.slice(0, 80_000));
writeFileSync(path.join(DIR, 'start.html'), start.body.slice(0, 80_000));

console.log(out.join('\n'));

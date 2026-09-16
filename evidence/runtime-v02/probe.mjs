#!/usr/bin/env node
/**
 * Runtime ingest-shape probe. Same file before and after v0.2.
 * Prints one JSON object. Does not print prompts.
 */
import { ArkIngest } from '../../packages/sdk/dist/index.js';
import { ProviderError } from '../../packages/providers/dist/index.js';
import { execute, PolicyError } from '../../packages/runtime/dist/index.js';
import { fakeAdapter } from '../../packages/runtime/dist/fake.js';

const SENTINEL = 'LEAK_SENTINEL';

function capturingIngest(posted) {
  return new ArkIngest({
    baseUrl: 'http://control.test',
    orgId: 'org_demo',
    timeoutMs: 50,
    fetch: (async (_url, init) => {
      posted.push(JSON.parse(String(init?.body)));
      return new Response(
        JSON.stringify({
          accepted: 1,
          tracesClosed: 1,
          priced: 1,
          unpriced: 0,
          alerts: 0,
          circuitBreaks: [],
        }),
        { status: 202 },
      );
    }),
  });
}

function summarize(posted) {
  const events = posted.flatMap((b) => b.events ?? []);
  const traces = posted.flatMap((b) => b.traces ?? []);
  const kinds = [...new Set(events.map((e) => e.errorKind).filter(Boolean))];
  const blob = JSON.stringify(posted);
  return {
    posts: posted.length,
    events: events.length,
    traces: traces.length,
    statuses: events.map((e) => e.status),
    turns: events.map((e) => e.turn),
    providers: events.map((e) => e.provider),
    errorKinds: kinds,
    outcomes: traces.map((t) => t.outcome),
    retries: traces.map((t) => t.retries),
    leakedSentinel: blob.includes(SENTINEL),
    leakedPrompt: blob.includes('secret prompt'),
  };
}

async function caseFallback() {
  const posted = [];
  const ollama = fakeAdapter({
    id: 'ollama',
    residency: 'local',
    complete: async () => {
      throw new ProviderError('http', `ollama HTTP 404: ${SENTINEL}`, 'ollama');
    },
  });
  const frontier = fakeAdapter({ id: 'openai-compatible', residency: 'cloud' });
  await execute(
    {
      messages: [{ role: 'user', content: 'secret prompt' }],
      constraints: { privacy: 'any' },
      maxFallbacks: 1,
      workloadId: 'wl_probe_fallback',
    },
    { adapters: [ollama, frontier], ingest: capturingIngest(posted) },
  );
  return summarize(posted);
}

async function caseRefusal() {
  const posted = [];
  const bedrock = fakeAdapter({ id: 'bedrock', residency: 'cloud' });
  try {
    await execute(
      {
        messages: [{ role: 'user', content: 'secret prompt' }],
        constraints: { privacy: 'local-only' },
        workloadId: 'wl_probe_refuse',
      },
      { adapters: [bedrock], ingest: capturingIngest(posted) },
    );
  } catch (err) {
    if (!(err instanceof PolicyError)) throw err;
  }
  return summarize(posted);
}

async function caseLeak() {
  const posted = [];
  const ollama = fakeAdapter({
    id: 'ollama',
    residency: 'local',
    complete: async () => {
      throw new ProviderError('http', `ollama HTTP 500: ${SENTINEL}`, 'ollama');
    },
  });
  try {
    await execute(
      {
        messages: [{ role: 'user', content: 'secret prompt' }],
        constraints: { privacy: 'local-only' },
        maxFallbacks: 0,
        workloadId: 'wl_probe_leak',
      },
      { adapters: [ollama], ingest: capturingIngest(posted) },
    );
  } catch {
    /* execution failed after ingest */
  }
  return summarize(posted);
}

const fallback = await caseFallback();
const refusal = await caseRefusal();
const leak = await caseLeak();
const report = { fallback, refusal, leak };
console.log(JSON.stringify(report, null, 2));

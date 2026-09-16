#!/usr/bin/env node
/**
 * Live Ollama inventory. Does not print prompts or keys.
 */
import { adaptersFromEnv } from '../../packages/providers/dist/index.js';
import { execute } from '../../packages/runtime/dist/index.js';

const base = process.env.ARK_OLLAMA_URL || 'http://127.0.0.1:11434';

async function tags() {
  const res = await fetch(`${base.replace(/\/+$/, '')}/api/tags`);
  const body = await res.json();
  return (body.models ?? []).map((m) => m.name);
}

function env(model) {
  return {
    ARK_OLLAMA_URL: base,
    ARK_OLLAMA_MODEL: model,
  };
}

async function run(label, { modelHint, defaultModel }) {
  const adapters = adaptersFromEnv({ env: env(defaultModel) });
  const ollama = adapters.find((a) => a.id === 'ollama');
  const started = Date.now();
  try {
    const out = await execute(
      {
        messages: [{ role: 'user', content: 'Reply with the single word pong.' }],
        model: modelHint,
        maxTokens: 8,
        temperature: 0,
        constraints: { privacy: 'local-only' },
        application: 'runtime-local-inventory-live',
      },
      { adapters: ollama ? [ollama] : [] },
    );
    return {
      label,
      ok: true,
      adapterId: out.adapterId,
      modelId: out.modelId,
      latencyMs: out.latencyMs,
      errorKind: null,
    };
  } catch (err) {
    return {
      label,
      ok: false,
      adapterId: null,
      modelId: null,
      latencyMs: Date.now() - started,
      errorKind: err && typeof err === 'object' && 'kind' in err ? err.kind : 'unknown',
      error: err instanceof Error ? err.message.slice(0, 240) : String(err).slice(0, 240),
    };
  }
}

const beforeTags = await tags();
const installed = await run('installed-smollm2', { modelHint: 'smollm2:135m', defaultModel: 'llama3.2' });
const family = await run('family-smollm2', { modelHint: 'smollm2', defaultModel: 'llama3.2' });
const missing = await run('missing-deepseek-r1', { modelHint: 'deepseek-r1', defaultModel: 'llama3.2' });
const missingDefault = await run('missing-default-llama3.2', { modelHint: undefined, defaultModel: 'llama3.2' });
const afterTags = await tags();

console.log(
  JSON.stringify(
    {
      base,
      beforeTags,
      afterTags,
      installed,
      family,
      missing,
      missingDefault,
      inventoryUnchanged: JSON.stringify(beforeTags) === JSON.stringify(afterTags),
    },
    null,
    2,
  ),
);

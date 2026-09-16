#!/usr/bin/env node
/**
 * Live open-weight completion against a local Ollama daemon.
 * Does not print prompts, keys, or completion text.
 */
import { adaptersFromEnv } from '../../packages/providers/dist/index.js';
import { execute } from '../../packages/runtime/dist/index.js';

const env = {
  ARK_OLLAMA_URL: process.env.ARK_OLLAMA_URL || 'http://127.0.0.1:11434',
  ARK_OLLAMA_MODEL: process.env.ARK_OLLAMA_MODEL || 'smollm2:135m',
};
const model = process.env.ARK_LIVE_MODEL || 'smollm2:135m';
const adapters = adaptersFromEnv({ env, timeoutMs: 60_000 });
const ollama = adapters.find((a) => a.id === 'ollama');

const report = {
  ollamaConfigured: ollama ? ollama.configured() : false,
  requestedModel: model,
  live: 'skipped',
};

if (!ollama?.configured()) {
  console.log(JSON.stringify(report, null, 2));
  process.exit(0);
}

try {
  const result = await execute(
    {
      messages: [{ role: 'user', content: 'Reply with the single word pong.' }],
      model,
      maxTokens: 8,
      temperature: 0,
      constraints: { privacy: 'local-only' },
      application: 'ark-open-weight-live',
    },
    { adapters },
  );
  report.live = 'ok';
  report.adapterId = result.adapterId;
  report.modelId = result.modelId;
  report.latencyMs = result.latencyMs;
  report.textChars = result.text.length;
  report.routingSelected = result.routing.selected;
  report.fallbacks = result.routing.fallbacks;
} catch (err) {
  report.live = 'error';
  report.error = err instanceof Error ? err.message : String(err);
}

console.log(JSON.stringify(report, null, 2));

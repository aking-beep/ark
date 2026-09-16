#!/usr/bin/env node
/**
 * Open-weight Runtime probe. Same file before and after.
 * Mocked fetch. Does not print prompts or keys.
 */
import { adaptersFromEnv, OllamaAdapter } from '../../packages/providers/dist/index.js';
import { hintAdapter } from '../../packages/runtime/dist/catalog.js';
import { execute } from '../../packages/runtime/dist/index.js';
import { fakeAdapter } from '../../packages/runtime/dist/fake.js';

const hints = Object.fromEntries(
  [
    'deepseek-r1',
    'deepseek-r1:8b',
    'deepseek-chat',
    'deepseek-reasoner',
    'smollm2:135m',
    'yi-34b',
    'granite-code',
    'olmo-2',
    'qwen2.5',
    'llama3.2',
    'gemma2',
    'phi3',
    'mixtral',
    'gpt-4o',
    'gpt-5-nano',
    'amazon.nova-lite-v1:0',
    'claude-sonnet-5',
  ].map((id) => [id, hintAdapter(id) ?? null]),
);

let ollamaPostedModel = null;
let ollamaPostedPath = null;
const ollama = new OllamaAdapter({
  baseUrl: 'http://ollama.test',
  model: 'llama3.2',
  fetch: async (url, init) => {
    ollamaPostedPath = new URL(String(url)).pathname;
    ollamaPostedModel = JSON.parse(String(init?.body)).model;
    return new Response(
      JSON.stringify({
        model: ollamaPostedModel,
        message: { role: 'assistant', content: 'ok' },
        prompt_eval_count: 1,
        eval_count: 1,
      }),
      { status: 200 },
    );
  },
});
await ollama.complete({
  messages: [{ role: 'user', content: 'hi' }],
  model: 'deepseek-r1',
  maxTokens: 8,
});

const deepseekEnv = adaptersFromEnv({ env: { DEEPSEEK_API_KEY: 'sk-test' } });
const frontier = deepseekEnv.find((a) => a.id === 'openai-compatible');
const ollamaFromEmpty = adaptersFromEnv({ env: {} }).find((a) => a.id === 'ollama');
const frontierFromEmpty = adaptersFromEnv({ env: {} }).find((a) => a.id === 'openai-compatible');

let deepseekUrl = null;
{
  const adapters = adaptersFromEnv({
    env: { DEEPSEEK_API_KEY: 'sk-test' },
    fetch: async (url, init) => {
      deepseekUrl = String(url);
      return new Response(
        JSON.stringify({
          model: 'deepseek-chat',
          choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }],
          usage: { prompt_tokens: 1, completion_tokens: 1 },
        }),
        { status: 200 },
      );
    },
  });
  const a = adapters.find((x) => x.id === 'openai-compatible');
  try {
    await a.complete({ messages: [{ role: 'user', content: 'hi' }], maxTokens: 8 });
  } catch {
    deepseekUrl = deepseekUrl || 'error';
  }
}

const routed = await execute(
  { messages: [{ role: 'user', content: 'hi' }], model: 'deepseek-r1', maxFallbacks: 1 },
  { adapters: [fakeAdapter({ id: 'ollama', residency: 'local' }), fakeAdapter({ id: 'openai-compatible', residency: 'cloud' })] },
);

const report = {
  hints,
  ollamaPostedModel,
  ollamaPostedPath,
  routedAdapter: routed.adapterId,
  deepseekConfigured: frontier ? frontier.configured() : false,
  deepseekDefaultModel: frontier ? frontier.defaultModel() : null,
  deepseekUrl,
  emptyEnvOllamaConfigured: ollamaFromEmpty ? ollamaFromEmpty.configured() : null,
  emptyEnvFrontierConfigured: frontierFromEmpty ? frontierFromEmpty.configured() : null,
};

console.log(JSON.stringify(report, null, 2));

#!/usr/bin/env node
/**
 * Hugging Face open-model Runtime probe. Same file before and after.
 * Frozen Hub ids from the 2026-09-16 downloads snapshot. Mocked fetch.
 * Does not print prompts or tokens.
 */
import { adaptersFromEnv, OllamaAdapter } from '../../packages/providers/dist/index.js';
import { hintAdapter } from '../../packages/runtime/dist/catalog.js';

const ids = [
  'openai/gpt-oss-20b',
  'gpt-oss:20b',
  'gpt-oss-20b',
  'openai/gpt-oss-120b',
  'Qwen/Qwen3-8B',
  'Qwen/Qwen3-0.6B',
  'Qwen/Qwen2.5-7B-Instruct',
  'unsloth/Qwen3-Coder-30B-A3B-Instruct-GGUF',
  'meta-llama/Llama-3.1-8B-Instruct',
  'meta-llama/Llama-3.2-1B-Instruct',
  'deepseek-ai/DeepSeek-R1',
  'deepseek-ai/DeepSeek-V4-Flash-0731',
  'google/gemma-3-1b-it',
  'HuggingFaceTB/SmolLM2-135M',
  'moonshotai/Kimi-K2-Instruct',
  'zai-org/GLM-5.2',
  'Qwen/QwQ-32B',
  'hf.co/bartowski/Llama-3.2-1B-Instruct-GGUF',
  'gpt-4o',
  'gpt-5-nano',
  'amazon.nova-lite-v1:0',
];

const hints = Object.fromEntries(ids.map((id) => [id, hintAdapter(id) ?? null]));

let ollamaPostedModel = null;
const ollama = new OllamaAdapter({
  baseUrl: 'http://ollama.test',
  model: 'llama3.2',
  fetch: async (_url, init) => {
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
  model: 'huggingface.co/bartowski/Llama-3.2-1B-Instruct-GGUF',
  maxTokens: 8,
});

const empty = adaptersFromEnv({ env: {} });
let hfUrl = null;
{
  const adapters = adaptersFromEnv({
    env: { HF_TOKEN: 'hf-test' },
    fetch: async (url) => {
      hfUrl = String(url);
      return new Response(
        JSON.stringify({
          model: 'Qwen/Qwen3-8B',
          choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }],
          usage: { prompt_tokens: 1, completion_tokens: 1 },
        }),
        { status: 200 },
      );
    },
  });
  const frontier = adapters.find((a) => a.id === 'openai-compatible');
  try {
    await frontier.complete({ messages: [{ role: 'user', content: 'hi' }], maxTokens: 8 });
  } catch {
    hfUrl = hfUrl || 'error';
  }
}

const hfOnly = adaptersFromEnv({ env: { HF_TOKEN: 'hf-test' } });
const deepseekWins = adaptersFromEnv({ env: { HF_TOKEN: 'hf-test', DEEPSEEK_API_KEY: 'sk-test' } });

const report = {
  hints,
  ollamaPostedModel,
  hfConfigured: hfOnly.find((a) => a.id === 'openai-compatible')?.configured() ?? false,
  hfDefaultModel: hfOnly.find((a) => a.id === 'openai-compatible')?.defaultModel() ?? null,
  hfUrl,
  deepseekWinsDefault: deepseekWins.find((a) => a.id === 'openai-compatible')?.defaultModel() ?? null,
  emptyEnvOllamaConfigured: empty.find((a) => a.id === 'ollama')?.configured() ?? null,
  emptyEnvFrontierConfigured: empty.find((a) => a.id === 'openai-compatible')?.configured() ?? null,
};

console.log(JSON.stringify(report, null, 2));

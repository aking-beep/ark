#!/usr/bin/env node
/**
 * Local-inventory probe. Same file before and after.
 * Mocked fetch. Does not print prompts or keys.
 */
import { adaptersFromEnv, OllamaAdapter } from '../../packages/providers/dist/index.js';

const req = { messages: [{ role: 'user', content: 'hi' }], maxTokens: 8 };

function mock({ installed }) {
  const calls = [];
  const fetchFn = async (url, init) => {
    const path = new URL(String(url), 'http://ollama.test').pathname;
    const method = String(init?.method || 'GET').toUpperCase();
    let model = null;
    if (init?.body) {
      try {
        model = JSON.parse(String(init.body)).model ?? null;
      } catch {
        model = null;
      }
    }
    calls.push({ method, path, model });
    if (path.endsWith('/api/tags')) {
      return new Response(JSON.stringify({ models: installed.map((name) => ({ name, model: name })) }), {
        status: 200,
      });
    }
    if (path.endsWith('/api/chat')) {
      return new Response(
        JSON.stringify({
          model,
          message: { role: 'assistant', content: 'ok' },
          prompt_eval_count: 1,
          eval_count: 1,
        }),
        { status: 200 },
      );
    }
    return new Response('unexpected', { status: 404 });
  };
  return { calls, fetchFn };
}

async function runCase(name, opts) {
  const { calls, fetchFn } = mock({ installed: opts.installed });
  const adapter = new OllamaAdapter({
    baseUrl: 'http://ollama.test',
    model: opts.defaultModel ?? 'llama3.2',
    fetch: fetchFn,
    allowPull: opts.allowPull,
  });
  let errorKind = null;
  let text = null;
  let modelId = null;
  try {
    const out = await adapter.complete({ ...req, model: opts.model });
    text = out.text;
    modelId = out.modelId;
  } catch (err) {
    errorKind = err && typeof err === 'object' && 'kind' in err ? err.kind : 'unknown';
  }
  const chatPosts = calls.filter((c) => c.path.endsWith('/api/chat'));
  const tagsGets = calls.filter((c) => c.path.endsWith('/api/tags') && c.method === 'GET');
  return {
    name,
    tagsGetCount: tagsGets.length,
    chatPostCount: chatPosts.length,
    postedModels: chatPosts.map((c) => c.model),
    errorKind,
    text,
    modelId,
  };
}

const cases = [
  await runCase('installed-exact', { installed: ['smollm2:135m'], model: 'smollm2:135m' }),
  await runCase('family-unique', { installed: ['smollm2:135m'], model: 'smollm2' }),
  await runCase('latest-alias', { installed: ['llama3.2:latest'], model: 'llama3.2' }),
  await runCase('hub-path', {
    installed: ['hf.co/bartowski/Llama-3.2-1B-Instruct-GGUF'],
    model: 'huggingface.co/bartowski/Llama-3.2-1B-Instruct-GGUF',
  }),
  await runCase('missing-no-pull', { installed: ['smollm2:135m'], model: 'deepseek-r1' }),
  await runCase('empty-inventory', { installed: [], model: 'llama3.2' }),
  await runCase('ambiguous-family', {
    installed: ['smollm2:135m', 'smollm2:360m'],
    model: 'smollm2',
  }),
  await runCase('missing-with-pull', {
    installed: ['smollm2:135m'],
    model: 'deepseek-r1',
    allowPull: true,
  }),
];

let envPullPosted = null;
let envPullTags = 0;
{
  const adapters = adaptersFromEnv({
    env: { ARK_OLLAMA_URL: 'http://ollama.test', ARK_OLLAMA_PULL: '1' },
    fetch: async (url, init) => {
      const path = new URL(String(url), 'http://ollama.test').pathname;
      if (path.endsWith('/api/tags')) {
        envPullTags += 1;
        return new Response(JSON.stringify({ models: [] }), { status: 200 });
      }
      if (init?.body) {
        envPullPosted = JSON.parse(String(init.body)).model;
      }
      return new Response(
        JSON.stringify({
          model: envPullPosted,
          message: { role: 'assistant', content: 'ok' },
          prompt_eval_count: 1,
          eval_count: 1,
        }),
        { status: 200 },
      );
    },
  });
  const ollama = adapters.find((a) => a.id === 'ollama');
  try {
    await ollama.complete({ ...req, model: 'deepseek-r1' });
  } catch {
    envPullPosted = envPullPosted || 'error';
  }
}

const empty = adaptersFromEnv({ env: {} });

const report = {
  cases,
  envPullPosted,
  envPullTags,
  emptyEnvOllamaConfigured: empty.find((a) => a.id === 'ollama')?.configured() ?? null,
};

console.log(JSON.stringify(report, null, 2));

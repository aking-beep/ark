#!/usr/bin/env node
/**
 * OpenAI runtime-path probe. Same file before and after.
 * Mocked fetch only. Does not print keys or prompts.
 */
import { adaptersFromEnv, OpenAICompatibleAdapter, parseOpenAIChat } from '../../packages/providers/dist/index.js';
import { hintAdapter } from '../../packages/runtime/dist/catalog.js';

async function payloadFor(model, extra = {}, defaultModel = '') {
  let posted = null;
  const adapter = new OpenAICompatibleAdapter({
    baseUrl: 'https://api.openai.com/v1',
    apiKey: 'k',
    model: defaultModel,
    fetch: async (url, init) => {
      posted = { url: String(url), body: JSON.parse(String(init?.body)) };
      return new Response(
        JSON.stringify({
          model,
          choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }],
          usage: { prompt_tokens: 1, completion_tokens: 1 },
        }),
        { status: 200 },
      );
    },
  });
  await adapter.complete({
    messages: [{ role: 'user', content: 'hi' }],
    model,
    maxTokens: 16,
    temperature: 0,
    ...extra,
  });
  return posted;
}

const envOnlyKey = adaptersFromEnv({ env: { OPENAI_API_KEY: 'sk-test' } });
const openai = envOnlyKey.find((a) => a.id === 'openai-compatible');

let envKeyCompleteUrl = null;
let envKeyCompleteError = null;
{
  let postedUrl = null;
  const adapters = adaptersFromEnv({
    env: { OPENAI_API_KEY: 'sk-test' },
    fetch: async (url) => {
      postedUrl = String(url);
      return new Response(
        JSON.stringify({
          model: 'gpt-4o-mini',
          choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }],
          usage: { prompt_tokens: 1, completion_tokens: 1 },
        }),
        { status: 200 },
      );
    },
  });
  const a = adapters.find((x) => x.id === 'openai-compatible');
  try {
    await a.complete({ messages: [{ role: 'user', content: 'hi' }], model: 'gpt-4o-mini', maxTokens: 8 });
    envKeyCompleteUrl = postedUrl;
  } catch (err) {
    envKeyCompleteError = err instanceof Error ? err.message.slice(0, 80) : 'error';
  }
}

const hints = Object.fromEntries(
  [
    'gpt-4o',
    'gpt-4o-mini',
    'gpt-5-nano',
    'gpt-5.6-sol',
    'chatgpt-4o-latest',
    'o3-mini',
    'o1',
    'ft:gpt-4o-mini:org:ft-abc',
    'text-embedding-3-small',
    'whisper-1',
    'dall-e-3',
    'tts-1',
    'llama3.2',
  ].map((id) => [id, hintAdapter(id) ?? null]),
);

let gpt5Payload = null;
let o3Payload = null;
let gpt4oPayload = null;
let completeWithoutDefaultModel = null;
try {
  gpt5Payload = await payloadFor('gpt-5-nano', {}, 'gpt-5-nano');
  o3Payload = await payloadFor('o3-mini', {}, 'o3-mini');
  gpt4oPayload = await payloadFor('gpt-4o', {}, 'gpt-4o');
} catch (err) {
  completeWithoutDefaultModel = err instanceof Error ? err.name : 'error';
}
try {
  await payloadFor('gpt-4o-mini');
  completeWithoutDefaultModel = 'ok';
} catch (err) {
  completeWithoutDefaultModel = err instanceof Error ? err.name : 'error';
}

const arrayParse = parseOpenAIChat(
  {
    model: 'gpt-4o',
    choices: [
      {
        message: {
          role: 'assistant',
          content: [
            { type: 'text', text: 'Hel' },
            { type: 'text', text: 'lo' },
          ],
        },
        finish_reason: 'stop',
      },
    ],
    usage: { prompt_tokens: 1, completion_tokens: 2 },
  },
  1,
  'gpt-4o',
);

const report = {
  openaiConfiguredFromOpenAIKey: openai ? openai.configured() : false,
  openaiDefaultModel: openai ? openai.defaultModel() : null,
  envKeyCompleteUrl,
  envKeyCompleteError,
  completeWithoutDefaultModel,
  hints,
  gpt5PayloadKeys: gpt5Payload ? Object.keys(gpt5Payload.body).sort() : null,
  o3PayloadKeys: o3Payload ? Object.keys(o3Payload.body).sort() : null,
  gpt4oPayloadKeys: gpt4oPayload ? Object.keys(gpt4oPayload.body).sort() : null,
  gpt5HasMaxTokens: Boolean(gpt5Payload?.body?.max_tokens),
  gpt5HasMaxCompletionTokens: Boolean(gpt5Payload?.body?.max_completion_tokens),
  o3HasTemperature: Object.prototype.hasOwnProperty.call(o3Payload?.body ?? {}, 'temperature'),
  arrayContentText: arrayParse.text,
};

console.log(JSON.stringify(report, null, 2));

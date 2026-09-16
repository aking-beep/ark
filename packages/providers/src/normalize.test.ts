import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseOllamaChat,
  parseOpenAIChat,
  parseBedrockConverse,
  toBedrockConverseBody,
  chatCompletionsUrl,
  openaiChatBody,
  isOpenAIChatModel,
  CompletionRequest,
} from './index.js';

const request = CompletionRequest.parse({
  messages: [
    { role: 'system', content: 'You are terse.' },
    { role: 'user', content: 'Say hi' },
  ],
  maxTokens: 32,
  temperature: 0,
});

describe('provider normalization', () => {
  test('the same CompletionRequest schema is what every adapter consumes', () => {
    assert.equal(request.messages.length, 2);
    assert.equal(request.maxTokens, 32);
  });

  test('Ollama chat JSON becomes NormalizedCompletion', () => {
    const out = parseOllamaChat(
      {
        model: 'llama3.2',
        message: { role: 'assistant', content: 'hi' },
        done_reason: 'stop',
        prompt_eval_count: 12,
        eval_count: 3,
      },
      40,
      'llama3.2',
    );
    assert.equal(out.text, 'hi');
    assert.equal(out.adapterId, 'ollama');
    assert.equal(out.catalogProvider, 'local');
    assert.equal(out.inputTokens, 12);
    assert.equal(out.outputTokens, 3);
    assert.equal(out.finishReason, 'stop');
    assert.equal(out.latencyMs, 40);
  });

  test('OpenAI-compatible chat JSON becomes NormalizedCompletion', () => {
    const out = parseOpenAIChat(
      {
        model: 'gpt-4o-mini',
        choices: [{ message: { role: 'assistant', content: 'hi' }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 9, completion_tokens: 2 },
      },
      80,
      'gpt-4o-mini',
    );
    assert.equal(out.text, 'hi');
    assert.equal(out.adapterId, 'openai-compatible');
    assert.equal(out.catalogProvider, 'openai');
    assert.equal(out.inputTokens, 9);
    assert.equal(out.outputTokens, 2);
  });

  test('OpenAI array content parts join into text', () => {
    const out = parseOpenAIChat(
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
      5,
      'gpt-4o',
    );
    assert.equal(out.text, 'Hello');
  });

  test('openaiChatBody uses max_completion_tokens for GPT-5 and drops temperature on o-series', () => {
    const gpt5 = openaiChatBody(
      { messages: [{ role: 'user', content: 'hi' }], model: 'gpt-5-nano', maxTokens: 8, temperature: 0 },
      '',
    );
    assert.equal(gpt5.max_completion_tokens, 8);
    assert.equal(gpt5.max_tokens, undefined);
    const o3 = openaiChatBody(
      { messages: [{ role: 'user', content: 'hi' }], model: 'o3-mini', maxTokens: 8, temperature: 0 },
      '',
    );
    assert.equal(o3.max_completion_tokens, 8);
    assert.equal(Object.prototype.hasOwnProperty.call(o3, 'temperature'), false);
    const gpt4o = openaiChatBody(
      { messages: [{ role: 'user', content: 'hi' }], model: 'gpt-4o', maxTokens: 8, temperature: 0 },
      '',
    );
    assert.equal(gpt4o.max_tokens, 8);
    assert.equal(gpt4o.temperature, 0);
  });

  test('isOpenAIChatModel covers the chat family and not embeddings or audio', () => {
    assert.equal(isOpenAIChatModel('chatgpt-4o-latest'), true);
    assert.equal(isOpenAIChatModel('ft:gpt-4o-mini:org:ft-abc'), true);
    assert.equal(isOpenAIChatModel('o3-mini'), true);
    assert.equal(isOpenAIChatModel('text-embedding-3-small'), false);
    assert.equal(isOpenAIChatModel('whisper-1'), false);
    assert.equal(isOpenAIChatModel('dall-e-3'), false);
  });

  test('Bedrock Converse JSON becomes NormalizedCompletion', () => {
    const out = parseBedrockConverse(
      {
        output: { message: { content: [{ text: 'hi' }] } },
        usage: { inputTokens: 11, outputTokens: 2 },
        stopReason: 'end_turn',
      },
      120,
      'amazon.nova-lite-v1:0',
    );
    assert.equal(out.text, 'hi');
    assert.equal(out.adapterId, 'bedrock');
    assert.equal(out.catalogProvider, 'bedrock');
    assert.equal(out.modelId, 'amazon.nova-lite-v1:0');
    assert.equal(out.inputTokens, 11);
  });

  test('Bedrock body splits system messages out of the turn list', () => {
    const body = toBedrockConverseBody(request.messages, 32, 0);
    assert.deepEqual(body.system, [{ text: 'You are terse.' }]);
    const msgs = body.messages as { role: string }[];
    assert.equal(msgs[0]!.role, 'user');
  });

  test('chatCompletionsUrl accepts a host, a /v1 base, or a full path', () => {
    assert.equal(chatCompletionsUrl('https://api.example.com'), 'https://api.example.com/v1/chat/completions');
    assert.equal(chatCompletionsUrl('https://api.example.com/v1'), 'https://api.example.com/v1/chat/completions');
    assert.equal(
      chatCompletionsUrl('https://api.example.com/v1/chat/completions'),
      'https://api.example.com/v1/chat/completions',
    );
  });
});

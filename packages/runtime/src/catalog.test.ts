import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { hintAdapter } from './catalog.js';

describe('OpenAI chat family hints', () => {
  test('gpt, chatgpt, o-series, and fine-tunes route to openai-compatible', () => {
    for (const id of [
      'gpt-4o',
      'gpt-4o-mini',
      'gpt-5-nano',
      'gpt-5.6-sol',
      'chatgpt-4o-latest',
      'o1',
      'o3-mini',
      'ft:gpt-4o-mini:org:ft-abc',
    ]) {
      assert.equal(hintAdapter(id), 'openai-compatible', id);
    }
  });

  test('non-chat OpenAI ids are not hinted at the chat adapter', () => {
    assert.equal(hintAdapter('text-embedding-3-small'), undefined);
    assert.equal(hintAdapter('whisper-1'), undefined);
    assert.equal(hintAdapter('dall-e-3'), undefined);
    assert.equal(hintAdapter('tts-1'), undefined);
  });
});

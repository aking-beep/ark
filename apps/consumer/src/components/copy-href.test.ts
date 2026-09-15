import { test } from 'node:test';
import assert from 'node:assert/strict';
import { copyHref } from './copy-href.js';

test('copyHref writes the current href and nothing else', async () => {
  const written: string[] = [];
  await copyHref({ writeText: async (s) => { written.push(s); } }, 'http://localhost:3000/result?i=abc');
  assert.deepEqual(written, ['http://localhost:3000/result?i=abc']);
});

test('copyHref fails closed when the clipboard is missing', async () => {
  await assert.rejects(() => copyHref(undefined, 'http://localhost:3000/result?i=abc'), /clipboard unavailable/);
});

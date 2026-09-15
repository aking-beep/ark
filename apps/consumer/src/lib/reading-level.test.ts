import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseReadingLevel } from './reading-level.js';

test('parseReadingLevel defaults anything but detailed to simple', () => {
  assert.equal(parseReadingLevel(null), 'simple');
  assert.equal(parseReadingLevel(''), 'simple');
  assert.equal(parseReadingLevel('simple'), 'simple');
  assert.equal(parseReadingLevel('Detailed'), 'simple');
  assert.equal(parseReadingLevel('detailed'), 'detailed');
});

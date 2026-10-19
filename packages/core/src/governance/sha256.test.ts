import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { sha256Hex } from './sha256.js';

const reference = (s: string) => createHash('sha256').update(s, 'utf8').digest('hex');

describe('sha256Hex', () => {
  test('FIPS 180-4 / NIST test vectors', () => {
    assert.equal(sha256Hex(''), 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
    assert.equal(sha256Hex('abc'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    assert.equal(
      sha256Hex('abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq'),
      '248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1',
    );
  });

  test('matches node:crypto across every length 0..300 (block and padding boundaries)', () => {
    for (let n = 0; n <= 300; n++) {
      const s = 'x'.repeat(n);
      assert.equal(sha256Hex(s), reference(s), `length ${n}`);
    }
  });

  test('matches node:crypto on multi-byte UTF-8 and a large input', () => {
    for (const s of ['é', '日本語のテキスト', '😀'.repeat(33), '{"a":1}\u0000￿', 'a'.repeat(1_000_003)]) {
      assert.equal(sha256Hex(s), reference(s));
    }
  });
});

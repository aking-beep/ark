import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { signBedrockConverse } from './sigv4.js';

describe('Bedrock SigV4', () => {
  test('is deterministic for a frozen clock and encodes the model id', () => {
    const a = signBedrockConverse({
      region: 'us-east-1',
      accessKeyId: 'AKIAEXAMPLE',
      secretAccessKey: 'wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY',
      modelId: 'amazon.nova-lite-v1:0',
      body: '{"messages":[]}',
      now: new Date('2026-09-16T03:36:47.000Z'),
    });
    const b = signBedrockConverse({
      region: 'us-east-1',
      accessKeyId: 'AKIAEXAMPLE',
      secretAccessKey: 'wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY',
      modelId: 'amazon.nova-lite-v1:0',
      body: '{"messages":[]}',
      now: new Date('2026-09-16T03:36:47.000Z'),
    });
    assert.equal(a.headers.authorization, b.headers.authorization);
    assert.match(a.url, /amazon\.nova-lite-v1%3A0/);
    assert.match(a.canonicalRequest, /^POST\n\/model\/amazon\.nova-lite-v1%3A0\/converse\n/);
    assert.match(a.headers.authorization!, /^AWS4-HMAC-SHA256 Credential=AKIAEXAMPLE\//);
    assert.equal(a.headers.host, undefined);
  });

  test('includes the session token in the signature when present', () => {
    const signed = signBedrockConverse({
      region: 'us-west-2',
      accessKeyId: 'ASIAEXAMPLE',
      secretAccessKey: 'secret',
      sessionToken: 'session',
      modelId: 'm',
      body: '{}',
      now: new Date('2026-01-01T00:00:00.000Z'),
    });
    assert.equal(signed.headers['x-amz-security-token'], 'session');
    assert.match(signed.canonicalRequest, /x-amz-security-token:session/);
  });
});

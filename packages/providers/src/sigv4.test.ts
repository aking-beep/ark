import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, createHmac } from 'node:crypto';
import { awsUriEncode, canonicalUri, deriveSigningKey, signBedrockConverse, signV4 } from './sigv4.js';

const sha = (s: string) => createHash('sha256').update(s, 'utf8').digest('hex');
const mac = (k: Buffer | string, s: string) => createHmac('sha256', k).update(s, 'utf8').digest();

describe('SigV4 known vectors (AWS documentation)', () => {
  test('signing key derivation matches the AWS documented example', () => {
    // "Examples of how to derive a signing key for Signature Version 4".
    const key = deriveSigningKey('wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY', '20120215', 'us-east-1', 'iam');
    assert.equal(key.toString('hex'), 'f4780e2d9f65fa895f9c67b32ce1baf0b0d8a43505a000a1a9e090d414db404d');
  });

  test('IAM ListUsers GET example produces the documented canonical hash and signature', () => {
    const signed = signV4({
      method: 'GET',
      canonicalUri: canonicalUri('/'),
      canonicalQuery: 'Action=ListUsers&Version=2010-05-08',
      headers: {
        'content-type': 'application/x-www-form-urlencoded; charset=utf-8',
        host: 'iam.amazonaws.com',
        'x-amz-date': '20150830T123600Z',
      },
      payloadHash: sha(''),
      amzDate: '20150830T123600Z',
      region: 'us-east-1',
      service: 'iam',
      accessKeyId: 'AKIDEXAMPLE',
      secretAccessKey: 'wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY',
    });
    assert.equal(sha(signed.canonicalRequest), 'f536975d06c0309214f805bb90ccff089219ecd68b2577efef23edd43b7e1a59');
    assert.equal(signed.signature, '5d672d79c15b13162d9279b0855cfba6789a8edb4c82c400e06b5924a6f2b5d7');
  });
});

describe('SigV4 URI encoding', () => {
  test('UriEncode escapes everything outside the unreserved set with uppercase hex', () => {
    assert.equal(awsUriEncode("a:b/c d!'()*~._-"), 'a%3Ab%2Fc%20d%21%27%28%29%2A~._-');
  });

  test('canonical URI double-encodes each segment (non-S3 services)', () => {
    assert.equal(canonicalUri('/model/amazon.nova-lite-v1%3A0/converse'), '/model/amazon.nova-lite-v1%253A0/converse');
    assert.equal(canonicalUri('/'), '/');
    assert.equal(canonicalUri(''), '/');
  });
});

describe('Bedrock SigV4', () => {
  const input = {
    region: 'us-east-1',
    accessKeyId: 'AKIAEXAMPLE',
    secretAccessKey: 'wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY',
    modelId: 'amazon.nova-lite-v1:0',
    body: '{"messages":[]}',
    now: new Date('2026-09-16T03:36:47.000Z'),
  };

  test('URL is single-encoded, canonical request is double-encoded', () => {
    const a = signBedrockConverse(input);
    const b = signBedrockConverse(input);
    assert.equal(a.headers.authorization, b.headers.authorization);
    assert.equal(a.url, 'https://bedrock-runtime.us-east-1.amazonaws.com/model/amazon.nova-lite-v1%3A0/converse');
    assert.match(a.canonicalRequest, /^POST\n\/model\/amazon\.nova-lite-v1%253A0\/converse\n\n/);
    assert.match(a.headers.authorization!, /^AWS4-HMAC-SHA256 Credential=AKIAEXAMPLE\/20260916\/us-east-1\/bedrock\/aws4_request,/);
    assert.equal(a.headers.host, undefined);
  });

  test('signature equals an independent computation from the spec', () => {
    const signed = signBedrockConverse(input);
    const payloadHash = sha(input.body);
    const canonical = [
      'POST',
      '/model/amazon.nova-lite-v1%253A0/converse',
      '',
      'content-type:application/json\n' +
        'host:bedrock-runtime.us-east-1.amazonaws.com\n' +
        `x-amz-content-sha256:${payloadHash}\n` +
        'x-amz-date:20260916T033647Z\n',
      'content-type;host;x-amz-content-sha256;x-amz-date',
      payloadHash,
    ].join('\n');
    assert.equal(signed.canonicalRequest, canonical);
    const scope = '20260916/us-east-1/bedrock/aws4_request';
    const sts = ['AWS4-HMAC-SHA256', '20260916T033647Z', scope, sha(canonical)].join('\n');
    const k = mac(mac(mac(mac(`AWS4${input.secretAccessKey}`, '20260916'), 'us-east-1'), 'bedrock'), 'aws4_request');
    const expected = createHmac('sha256', k).update(sts, 'utf8').digest('hex');
    assert.equal(
      signed.headers.authorization,
      `AWS4-HMAC-SHA256 Credential=AKIAEXAMPLE/${scope}, SignedHeaders=content-type;host;x-amz-content-sha256;x-amz-date, Signature=${expected}`,
    );
  });

  test('ARN model ids (with / and :) are encoded once on the wire and twice in the canonical URI', () => {
    const arn = 'arn:aws:bedrock:us-east-1:123456789012:inference-profile/us.amazon.nova-lite-v1:0';
    const signed = signBedrockConverse({ ...input, modelId: arn });
    const once = encodeURIComponent(arn);
    assert.equal(signed.url.endsWith(`/model/${once}/converse`), true);
    assert.equal(signed.canonicalRequest.split('\n')[1], `/model/${encodeURIComponent(once)}/converse`);
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

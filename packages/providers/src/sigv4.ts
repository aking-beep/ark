import { createHash, createHmac } from 'node:crypto';

function sha256Hex(data: string): string {
  return createHash('sha256').update(data, 'utf8').digest('hex');
}

function hmac(key: Buffer | string, data: string): Buffer {
  return createHmac('sha256', key).update(data, 'utf8').digest();
}

export interface BedrockSignInput {
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken?: string;
  modelId: string;
  body: string;
  now?: Date;
}

export interface BedrockSignOutput {
  url: string;
  headers: Record<string, string>;
  amzDate: string;
  canonicalRequest: string;
}

/**
 * Sign a Bedrock Runtime Converse request. Host is included in the signature
 * but omitted from the returned headers so undici can set it.
 */
export function signBedrockConverse(opts: BedrockSignInput): BedrockSignOutput {
  const now = opts.now ?? new Date();
  const amzDate = now.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
  const dateStamp = amzDate.slice(0, 8);
  const host = `bedrock-runtime.${opts.region}.amazonaws.com`;
  const path = `/model/${encodeURIComponent(opts.modelId)}/converse`;
  const payloadHash = sha256Hex(opts.body);

  const headerMap: Record<string, string> = {
    host,
    'content-type': 'application/json',
    'x-amz-content-sha256': payloadHash,
    'x-amz-date': amzDate,
  };
  if (opts.sessionToken) headerMap['x-amz-security-token'] = opts.sessionToken;

  const signedHeaderNames = Object.keys(headerMap).sort();
  const canonicalHeaders = signedHeaderNames.map((n) => `${n}:${headerMap[n]!.trim()}\n`).join('');
  const signedHeaders = signedHeaderNames.join(';');
  const canonicalRequest = ['POST', path, '', canonicalHeaders, signedHeaders, payloadHash].join('\n');

  const scope = `${dateStamp}/${opts.region}/bedrock/aws4_request`;
  const stringToSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256Hex(canonicalRequest)].join('\n');

  const kDate = hmac(`AWS4${opts.secretAccessKey}`, dateStamp);
  const kRegion = hmac(kDate, opts.region);
  const kService = hmac(kRegion, 'bedrock');
  const kSigning = hmac(kService, 'aws4_request');
  const signature = createHmac('sha256', kSigning).update(stringToSign, 'utf8').digest('hex');

  const headers: Record<string, string> = {
    'content-type': 'application/json',
    authorization: `AWS4-HMAC-SHA256 Credential=${opts.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
    'x-amz-content-sha256': payloadHash,
    'x-amz-date': amzDate,
  };
  if (opts.sessionToken) headers['x-amz-security-token'] = opts.sessionToken;

  return { url: `https://${host}${path}`, headers, amzDate, canonicalRequest };
}

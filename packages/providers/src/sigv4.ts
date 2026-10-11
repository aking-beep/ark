import { createHash, createHmac } from 'node:crypto';

function sha256Hex(data: string): string {
  return createHash('sha256').update(data, 'utf8').digest('hex');
}

function hmac(key: Buffer | string, data: string): Buffer {
  return createHmac('sha256', key).update(data, 'utf8').digest();
}

/**
 * SigV4 UriEncode: every byte except the RFC 3986 unreserved set
 * (A-Z a-z 0-9 - . _ ~) becomes %XY with uppercase hex. encodeURIComponent
 * leaves ! ' ( ) * alone, which AWS does not.
 */
export function awsUriEncode(segment: string): string {
  return encodeURIComponent(segment).replace(
    /[!'()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

/**
 * Canonical URI for every service except S3: each segment of the (already
 * once-encoded) request path is URI-encoded again. A Bedrock model id
 * `a:b` is `/model/a%3Ab/...` on the wire and `/model/a%253Ab/...` in the
 * canonical request.
 */
export function canonicalUri(encodedPath: string): string {
  if (!encodedPath || encodedPath === '/') return '/';
  return encodedPath
    .split('/')
    .map((seg) => awsUriEncode(seg))
    .join('/');
}

export function deriveSigningKey(
  secretAccessKey: string,
  dateStamp: string,
  region: string,
  service: string,
): Buffer {
  const kDate = hmac(`AWS4${secretAccessKey}`, dateStamp);
  const kRegion = hmac(kDate, region);
  const kService = hmac(kRegion, service);
  return hmac(kService, 'aws4_request');
}

export interface SignV4Input {
  method: string;
  /** Canonical URI, already double-encoded where the service requires it. */
  canonicalUri: string;
  canonicalQuery: string;
  /** Lower-case header names → values. Must include host. */
  headers: Record<string, string>;
  payloadHash: string;
  amzDate: string;
  region: string;
  service: string;
  accessKeyId: string;
  secretAccessKey: string;
}

export interface SignV4Output {
  canonicalRequest: string;
  stringToSign: string;
  signature: string;
  authorization: string;
  signedHeaders: string;
}

/** The service-agnostic core of SigV4 (header-based auth). */
export function signV4(input: SignV4Input): SignV4Output {
  const dateStamp = input.amzDate.slice(0, 8);
  const signedHeaderNames = Object.keys(input.headers).sort();
  const canonicalHeaders = signedHeaderNames
    .map((n) => `${n}:${input.headers[n]!.trim().replace(/\s+/g, ' ')}\n`)
    .join('');
  const signedHeaders = signedHeaderNames.join(';');
  const canonicalRequest = [
    input.method,
    input.canonicalUri,
    input.canonicalQuery,
    canonicalHeaders,
    signedHeaders,
    input.payloadHash,
  ].join('\n');
  const scope = `${dateStamp}/${input.region}/${input.service}/aws4_request`;
  const stringToSign = ['AWS4-HMAC-SHA256', input.amzDate, scope, sha256Hex(canonicalRequest)].join('\n');
  const kSigning = deriveSigningKey(input.secretAccessKey, dateStamp, input.region, input.service);
  const signature = createHmac('sha256', kSigning).update(stringToSign, 'utf8').digest('hex');
  return {
    canonicalRequest,
    stringToSign,
    signature,
    signedHeaders,
    authorization: `AWS4-HMAC-SHA256 Credential=${input.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
  };
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
  const host = `bedrock-runtime.${opts.region}.amazonaws.com`;
  // Wire path: encoded once. Canonical URI: each segment encoded again.
  const path = `/model/${awsUriEncode(opts.modelId)}/converse`;
  const payloadHash = sha256Hex(opts.body);

  const headerMap: Record<string, string> = {
    host,
    'content-type': 'application/json',
    'x-amz-content-sha256': payloadHash,
    'x-amz-date': amzDate,
  };
  if (opts.sessionToken) headerMap['x-amz-security-token'] = opts.sessionToken;

  const signed = signV4({
    method: 'POST',
    canonicalUri: canonicalUri(path),
    canonicalQuery: '',
    headers: headerMap,
    payloadHash,
    amzDate,
    region: opts.region,
    service: 'bedrock',
    accessKeyId: opts.accessKeyId,
    secretAccessKey: opts.secretAccessKey,
  });

  const headers: Record<string, string> = {
    'content-type': 'application/json',
    authorization: signed.authorization,
    'x-amz-content-sha256': payloadHash,
    'x-amz-date': amzDate,
  };
  if (opts.sessionToken) headers['x-amz-security-token'] = opts.sessionToken;

  return { url: `https://${host}${path}`, headers, amzDate, canonicalRequest: signed.canonicalRequest };
}

/** Request headers the AI Fit API needs. Everything else (cookies, auth, accept-encoding, hop-by-hop) stays here. */
const FORWARDED_REQUEST_HEADERS = ["content-type", "accept", "accept-language", "user-agent"] as const;

/**
 * Response headers never copied back. fetch() already decoded the body, so the
 * upstream content-encoding/content-length no longer describe what we send.
 */
const STRIPPED_RESPONSE_HEADERS = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailers",
  "transfer-encoding",
  "upgrade",
  "content-encoding",
  "content-length",
  "set-cookie",
]);

export const MY_AI_PROXY_TIMEOUT_MS = 20_000;
export const MY_AI_PROXY_MAX_BODY_BYTES = 1024 * 1024;

/** Origin of the Python AI Fit API. Empty on Vercel, where the platform rewrite hits the API service. */
export function myAiApiOrigin(): string | null {
  const fromEnv = process.env.API_ORIGIN?.trim();
  if (fromEnv) return fromEnv.replace(/\/$/, "");
  if (process.env.VERCEL) return null;
  return "http://127.0.0.1:8472";
}

/**
 * Build the upstream `/v1/...` path from decoded route segments. Each segment is
 * re-encoded, so a decoded `%2F` or `?` cannot change the path or query upstream.
 * Returns null for dot segments, empty segments, separators, or control characters.
 */
export function buildUpstreamPath(segments: readonly string[], search = ""): string | null {
  if (!segments.length) return null;
  const encoded: string[] = [];
  for (const segment of segments) {
    if (!segment || segment === "." || segment === "..") return null;
    if (/[/\\\u0000-\u001f\u007f]/.test(segment)) return null;
    encoded.push(encodeURIComponent(segment));
  }
  const query = search && search !== "?" ? (search.startsWith("?") ? search : `?${search}`) : "";
  return `/v1/${encoded.join("/")}${query}`;
}

/** Copy only allow-listed request headers, plus the client IP for the API's rate limiter. */
export function upstreamRequestHeaders(incoming: Headers): Headers {
  const headers = new Headers();
  for (const name of FORWARDED_REQUEST_HEADERS) {
    const value = incoming.get(name);
    if (value !== null) headers.set(name, value);
  }
  // Best effort: the hop nearest to us is the last X-Forwarded-For entry.
  const forwarded = incoming.get("x-forwarded-for");
  const client = forwarded?.split(",").map((part) => part.trim()).filter(Boolean).pop() ?? incoming.get("x-real-ip");
  if (client && /^[0-9a-fA-F:.]{2,45}$/.test(client)) headers.set("x-forwarded-for", client);
  return headers;
}

export function downstreamResponseHeaders(upstream: Headers): Headers {
  const out = new Headers();
  upstream.forEach((value, key) => {
    if (!STRIPPED_RESPONSE_HEADERS.has(key.toLowerCase())) out.set(key, value);
  });
  return out;
}

class BodyTooLarge extends Error {}

/** Read the request body, refusing (declared or streamed) bodies over maxBytes. */
export async function readBodyCapped(request: Request, maxBytes = MY_AI_PROXY_MAX_BODY_BYTES): Promise<Uint8Array> {
  const declared = request.headers.get("content-length");
  if (declared !== null && (!/^\d+$/.test(declared) || Number(declared) > maxBytes)) throw new BodyTooLarge();
  if (!request.body) return new Uint8Array(0);
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) {
      await reader.cancel().catch(() => undefined);
      throw new BodyTooLarge();
    }
    chunks.push(value);
  }
  const body = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}

export async function proxyMyAiRequest(
  pathAndQuery: string,
  request: Request,
  opts?: { timeoutMs?: number; fetch?: typeof fetch; maxBodyBytes?: number },
): Promise<Response> {
  const origin = myAiApiOrigin();
  if (!origin) {
    return Response.json({ error: "AI Fit API is not configured (set API_ORIGIN)." }, { status: 502 });
  }

  const path = pathAndQuery.startsWith("/") ? pathAndQuery : `/${pathAndQuery}`;
  const url = `${origin}${path}`;
  const timeoutMs = opts?.timeoutMs ?? MY_AI_PROXY_TIMEOUT_MS;
  const fetchFn = opts?.fetch ?? fetch;

  const method = request.method.toUpperCase();
  const hasBody = method !== "GET" && method !== "HEAD";
  let body: Uint8Array | undefined;
  if (hasBody) {
    try {
      body = await readBodyCapped(request, opts?.maxBodyBytes ?? MY_AI_PROXY_MAX_BODY_BYTES);
    } catch (err) {
      if (err instanceof BodyTooLarge) {
        return Response.json({ error: "Request body too large." }, { status: 413 });
      }
      return Response.json({ error: "Could not read the request body." }, { status: 400 });
    }
  }

  try {
    const upstream = await fetchFn(url, {
      method,
      headers: upstreamRequestHeaders(request.headers),
      body: body as BodyInit | undefined,
      redirect: "manual",
      signal: AbortSignal.timeout(timeoutMs),
    });
    return new Response(upstream.body, {
      status: upstream.status,
      statusText: upstream.statusText,
      headers: downstreamResponseHeaders(upstream.headers),
    });
  } catch (err) {
    const timedOut =
      err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError");
    return Response.json(
      { error: timedOut ? "AI Fit API timed out" : "AI Fit API is unreachable" },
      { status: timedOut ? 504 : 502 },
    );
  }
}

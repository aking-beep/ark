const HOP_BY_HOP = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailers",
  "transfer-encoding",
  "upgrade",
  "host",
  "content-length",
]);

export const MY_AI_PROXY_TIMEOUT_MS = 20_000;

/** Origin of the Python AI Fit API. Empty on Vercel, where the platform rewrite hits the API service. */
export function myAiApiOrigin(): string | null {
  const fromEnv = process.env.API_ORIGIN?.trim();
  if (fromEnv) return fromEnv.replace(/\/$/, "");
  if (process.env.VERCEL) return null;
  return "http://127.0.0.1:8472";
}

export async function proxyMyAiRequest(
  pathAndQuery: string,
  request: Request,
  opts?: { timeoutMs?: number; fetch?: typeof fetch },
): Promise<Response> {
  const origin = myAiApiOrigin();
  if (!origin) {
    return Response.json({ error: "AI Fit API is not configured (set API_ORIGIN)." }, { status: 502 });
  }

  const path = pathAndQuery.startsWith("/") ? pathAndQuery : `/${pathAndQuery}`;
  const url = `${origin}${path}`;
  const timeoutMs = opts?.timeoutMs ?? MY_AI_PROXY_TIMEOUT_MS;
  const fetchFn = opts?.fetch ?? fetch;

  const headers = new Headers();
  request.headers.forEach((value, key) => {
    if (!HOP_BY_HOP.has(key.toLowerCase())) headers.set(key, value);
  });

  const method = request.method.toUpperCase();
  const hasBody = method !== "GET" && method !== "HEAD";
  const body = hasBody ? await request.arrayBuffer() : undefined;

  try {
    const upstream = await fetchFn(url, {
      method,
      headers,
      body,
      redirect: "manual",
      signal: AbortSignal.timeout(timeoutMs),
    });
    const outHeaders = new Headers(upstream.headers);
    for (const hop of HOP_BY_HOP) outHeaders.delete(hop);
    return new Response(upstream.body, {
      status: upstream.status,
      statusText: upstream.statusText,
      headers: outHeaders,
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

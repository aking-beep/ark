import { ProviderError, type AdapterId, type FetchFn } from './types.js';

export async function fetchWithTimeout(
  fetchFn: FetchFn,
  url: string,
  init: RequestInit,
  timeoutMs: number,
  adapterId: AdapterId,
): Promise<Response> {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  try {
    return await fetchFn(url, { ...init, signal: ac.signal });
  } catch (err) {
    if (ac.signal.aborted) {
      throw new ProviderError('timeout', `${adapterId} timed out after ${timeoutMs}ms`, adapterId, {
        cause: err,
      });
    }
    throw new ProviderError('network', `${adapterId} network error`, adapterId, { cause: err });
  } finally {
    clearTimeout(timer);
  }
}

export async function readJson(res: Response, adapterId: AdapterId): Promise<unknown> {
  const text = await res.text();
  if (!res.ok) {
    throw new ProviderError(
      'http',
      `${adapterId} HTTP ${res.status}: ${text.slice(0, 400)}`,
      adapterId,
    );
  }
  try {
    return JSON.parse(text) as unknown;
  } catch (err) {
    throw new ProviderError('parse', `${adapterId} returned non-JSON`, adapterId, { cause: err });
  }
}

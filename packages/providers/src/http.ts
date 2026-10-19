import { ProviderError, type AdapterId, type FetchFn } from './types.js';

/**
 * One time budget for a whole complete() call. Every request made under it
 * (Ollama's /api/tags then /api/chat) shares the same timer, and the timer
 * keeps running through the body read, not only until headers arrive.
 * An outer signal (the caller giving up) aborts it too.
 */
export class Deadline {
  readonly signal: AbortSignal;
  private readonly ac = new AbortController();
  private readonly timer: ReturnType<typeof setTimeout>;
  private timedOutFlag = false;
  private readonly onOuterAbort?: () => void;

  constructor(
    readonly timeoutMs: number,
    private readonly outer?: AbortSignal,
  ) {
    this.signal = this.ac.signal;
    this.timer = setTimeout(() => {
      this.timedOutFlag = true;
      this.ac.abort();
    }, timeoutMs);
    if (outer) {
      if (outer.aborted) {
        this.ac.abort();
      } else {
        this.onOuterAbort = () => this.ac.abort();
        outer.addEventListener('abort', this.onOuterAbort, { once: true });
      }
    }
  }

  get timedOut(): boolean {
    return this.timedOutFlag;
  }

  /** Throw the right ProviderError if the deadline or the caller already fired. */
  check(adapterId: AdapterId): void {
    if (this.signal.aborted) throw this.abortError(adapterId);
  }

  abortError(adapterId: AdapterId, cause?: unknown): ProviderError {
    if (this.timedOutFlag) {
      return new ProviderError('timeout', `${adapterId} timed out after ${this.timeoutMs}ms`, adapterId, { cause });
    }
    return new ProviderError('aborted', `${adapterId} request aborted by caller`, adapterId, { cause });
  }

  dispose(): void {
    clearTimeout(this.timer);
    if (this.outer && this.onOuterAbort) this.outer.removeEventListener('abort', this.onOuterAbort);
  }
}

/**
 * fetch + body read + JSON parse under one deadline. A provider that sends
 * headers and then stalls the body still times out.
 */
export async function requestJson(
  fetchFn: FetchFn,
  url: string,
  init: RequestInit,
  deadline: Deadline,
  adapterId: AdapterId,
): Promise<unknown> {
  deadline.check(adapterId);
  let res: Response;
  let text: string;
  try {
    res = await fetchFn(url, { ...init, signal: deadline.signal });
    text = await raceAbort(res.text(), deadline.signal);
  } catch (err) {
    if (deadline.signal.aborted) throw deadline.abortError(adapterId, err);
    throw new ProviderError('network', `${adapterId} network error`, adapterId, { cause: err });
  }
  if (!res.ok) {
    throw new ProviderError('http', `${adapterId} HTTP ${res.status}: ${text.slice(0, 400)}`, adapterId);
  }
  try {
    return JSON.parse(text) as unknown;
  } catch (err) {
    throw new ProviderError('parse', `${adapterId} returned non-JSON`, adapterId, { cause: err });
  }
}

/** Some fetch implementations (and test fakes) ignore the signal while reading the body. */
function raceAbort<T>(p: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(new Error('aborted'));
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(new Error('aborted'));
    signal.addEventListener('abort', onAbort, { once: true });
    p.then(
      (v) => {
        signal.removeEventListener('abort', onAbort);
        resolve(v);
      },
      (e) => {
        signal.removeEventListener('abort', onAbort);
        reject(e);
      },
    );
  });
}

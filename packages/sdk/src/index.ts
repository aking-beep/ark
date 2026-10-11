import {
  IngestBody,
  EventInput,
  EvidenceInput,
  type TraceClose,
  type ActionInput,
  type QualitySampleInput,
  type EvidenceObservation,
  detectSensitive,
  redactEvidence,
  redactMetadata,
  EVENT_SAMPLE_MAX_CHARS,
  INGEST_MAX_EVENTS,
  INGEST_MAX_ROWS,
} from '@ark/core';
import { activeTrace, hrefOf, isControlIngestUrl, observeLlmCall } from './instrument.js';

export { observeLlmCall, isControlIngestUrl } from './instrument.js';

export interface ArkClientOptions {
  /** Origin of ARK Control, e.g. http://localhost:3002 */
  baseUrl: string;
  token?: string;
  /**
   * Omit it. The token decides which org a batch belongs to; Control rejects
   * a body whose orgId names a different org. Set it only to make that check
   * explicit — it is never defaulted.
   */
  orgId?: string;
  fetch?: typeof fetch;
  /** Bound on the ingest POST. A hung Control must not hang the caller. */
  timeoutMs?: number;
  /**
   * Scan `sample` locally and send labels only, and redact protocol evidence
   * metadata before it is posted. Default true — with it on, neither a prompt
   * nor a protocol payload has to leave the process at all.
   */
  scanLocally?: boolean;
  /**
   * How long `close()`/`flush()` wait for in-flight recordings — a streamed
   * response whose usage arrives with its last chunk. Default 5000 ms.
   */
  pendingTimeoutMs?: number;
}

type EventDraft = {
  provider: string;
  modelId: string;
  id?: string;
  turn?: number;
  ts?: number;
  inputTokens?: number;
  outputTokens?: number;
  cachedInputTokens?: number;
  costUsd?: number;
  latencyMs?: number;
  status?: EventInput['status'];
  errorKind?: string;
  sample?: string;
  sensitiveMatches?: string[];
  userId?: string;
  application?: string;
  agentId?: string;
};

function id(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Ingest client. The job it does is the one people otherwise get wrong:
 * one trace id per unit of work, and a monotonic turn index inside it.
 */
export class ArkIngest {
  private readonly fetchFn: typeof fetch;
  constructor(private readonly opts: ArkClientOptions) {
    this.fetchFn = opts.fetch ?? fetch;
  }

  /** Open a trace. Turn 0 is the first event you record on it. */
  trace(workloadId: string, traceId = id('tr')): TraceHandle {
    return new TraceHandle(
      this,
      workloadId,
      traceId,
      this.opts.scanLocally !== false,
      this.opts.pendingTimeoutMs ?? 5_000,
    );
  }

  /**
   * Run one unit of work. Everything `instrumentFetch` sees inside `fn` lands
   * on one trace, with a monotonic turn index, and the trace closes when `fn`
   * returns. Ingest is best-effort: a Control outage must not fail the work.
   *
   * `fn` receives the handle so protocol evidence and actions can join the
   * same trace as the model calls.
   */
  async run<T>(
    workloadId: string,
    fn: (trace: TraceHandle) => Promise<T> | T,
    opts?: { traceId?: string; agentId?: string },
  ): Promise<T> {
    const trace = this.trace(workloadId, opts?.traceId);
    if (opts?.agentId) trace.bindAgent(opts.agentId);
    return activeTrace.run(trace, async () => {
      try {
        const result = await fn(trace);
        await trace.close('success').catch(() => undefined);
        return result;
      } catch (err) {
        await trace.close('failure').catch(() => undefined);
        throw err;
      }
    });
  }

  /**
   * A `fetch` that records OpenAI `/chat/completions` and Anthropic
   * `/v1/messages` as model events on the `run()` that is in progress.
   *
   * Pass it as `fetch` to the client you already have. It never stores the
   * prompt. It never records Control's own ingest URL as a model call. Outside
   * `run()` it is a pass-through.
   *
   * The Response is handed back the moment it arrives. Recording reads a
   * clone in the background, so a streamed (`text/event-stream`) completion
   * streams to the caller exactly as it would have without ARK; its usage is
   * taken from the last chunk that carries one, and a stream with no usage is
   * skipped. Latency is measured to the end of the body.
   */
  instrumentFetch(baseFetch?: typeof fetch): typeof fetch {
    const inner = baseFetch ?? this.fetchFn;
    return async (input: Parameters<typeof fetch>[0], init?: RequestInit): Promise<Response> => {
      const url = hrefOf(input);
      if (isControlIngestUrl(url)) return inner(input, init);
      const started = Date.now();
      const res = await inner(input, init);
      const handle = activeTrace.getStore();
      if (!handle) return res;
      let copy: Response;
      try {
        copy = res.clone();
      } catch {
        return res; // body already used or not cloneable: fail open
      }
      const requestBody = typeof init?.body === 'string' ? init.body : undefined;
      const recording = (async () => {
        try {
          const responseBody = await copy.text();
          const draft = observeLlmCall({
            url,
            requestBody,
            responseBody,
            latencyMs: Date.now() - started,
            status: res.status,
            contentType: res.headers.get('content-type'),
          });
          if (draft) handle.event(draft);
        } catch {
          // Fail open. The user already has their response.
        }
      })();
      handle.track?.(recording);
      return res;
    };
  }

  async ingest(body: unknown): Promise<IngestResponse> {
    // orgId only when configured — never defaulted. The token decides tenancy.
    const parsed = IngestBody.parse({
      ...(this.opts.orgId ? { orgId: this.opts.orgId } : {}),
      ...(body as object),
    });
    const url = new URL('/api/v1/events', this.opts.baseUrl);
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    if (this.opts.token) headers.authorization = `Bearer ${this.opts.token}`;
    const timeoutMs = this.opts.timeoutMs ?? 10_000;
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), timeoutMs);
    try {
      const res = await this.fetchFn(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(parsed),
        signal: ac.signal,
      });
      if (!res.ok && res.status !== 202) {
        const text = await res.text().catch(() => '');
        throw new Error(`ARK ingest failed (${res.status}): ${text.slice(0, 400)}`);
      }
      // Awaited here so the body read is inside the timeout, not after it.
      return (await res.json()) as IngestResponse;
    } catch (err) {
      if (ac.signal.aborted) {
        throw new Error(`ARK ingest timed out after ${timeoutMs}ms`);
      }
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }
}

export interface IngestResponse {
  accepted: number;
  tracesClosed: number;
  actionsAccepted?: number;
  qualityAccepted?: number;
  evidenceAccepted?: number;
  /** Metadata keys Control dropped before storing. Names only, never values. */
  evidenceRedacted?: string[];
  priced: number;
  unpriced: number;
  alerts: number;
  circuitBreaks: { traceId: string; reason: string }[];
}

export class TraceHandle {
  private nextTurn = 0;
  private events: EventInput[] = [];
  private actions: ActionInput[] = [];
  private quality: QualitySampleInput[] = [];
  private evidenceRows: EvidenceInput[] = [];
  private closed: TraceClose | null = null;
  private agentId: string | undefined;

  private pending = new Set<Promise<unknown>>();

  constructor(
    private readonly client: ArkIngest,
    readonly workloadId: string,
    readonly traceId: string,
    private readonly scanLocally: boolean,
    private readonly pendingTimeoutMs = 5_000,
  ) {}

  /** See `TraceSink.track`. */
  track(p: Promise<unknown>): void {
    this.pending.add(p);
    const done = () => {
      this.pending.delete(p);
    };
    p.then(done, done);
  }

  /** Attach a registered agent identity to subsequent events on this trace. */
  bindAgent(agentId: string): this {
    this.agentId = agentId;
    return this;
  }

  /**
   * Record one model call. If `turn` is omitted, the next index is assigned.
   * Callers who pass `turn` keep control; the SDK will not go backwards.
   */
  event(draft: EventDraft): this {
    const turn = draft.turn ?? this.nextTurn;
    this.nextTurn = Math.max(this.nextTurn, turn + 1);
    let sensitiveMatches = draft.sensitiveMatches;
    let sample = draft.sample;
    if (this.scanLocally && sample) {
      sensitiveMatches = [...new Set([...(sensitiveMatches ?? []), ...detectSensitive(sample)])];
      sample = undefined;
    } else if (sample && sample.length > EVENT_SAMPLE_MAX_CHARS) {
      sample = sample.slice(0, EVENT_SAMPLE_MAX_CHARS);
    }
    const parsed = EventInput.parse({
      ...draft,
      sample,
      sensitiveMatches,
      id: draft.id ?? id('ev'),
      traceId: this.traceId,
      workloadId: this.workloadId,
      turn,
      agentId: draft.agentId ?? this.agentId,
    });
    this.events.push(parsed);
    return this;
  }

  action(draft: Omit<ActionInput, 'id' | 'traceId'> & { id?: string }): this {
    this.actions.push({
      ...draft,
      id: draft.id ?? id('ac'),
      traceId: this.traceId,
      workloadId: draft.workloadId ?? this.workloadId,
    });
    return this;
  }

  /**
   * Record one normalised protocol observation on this trace.
   *
   * Takes what `@ark/protocols` produces, so the usual call reads
   * `trace.evidence(mcpEvidence({ ... }))`. The trace id is this handle's and
   * is not overridable, exactly as in `event()` and `action()` above: that is
   * the whole point of recording on a handle, and an adapter that carried a
   * stale `traceId` would otherwise silently re-point the observation at
   * another unit of work. The workload may be overridden, because one trace
   * can legitimately touch more than one.
   *
   * With `scanLocally` on (the default) metadata is redacted here, before the
   * POST, so a payload the caller attached never leaves this process.
   */
  evidence(observation: EvidenceObservation): this {
    // Redact metadata before the parse as well as after it: a key the schema
    // would reject (too long, not an identifier) is dropped here rather than
    // throwing out the whole observation.
    const metadata = this.scanLocally && observation.metadata
      ? redactMetadata(observation.metadata).metadata
      : observation.metadata;
    const parsed = EvidenceInput.parse({
      ...observation,
      metadata,
      id: observation.id ?? id('pe'),
      traceId: this.traceId,
      workloadId: observation.workloadId ?? this.workloadId,
    });
    this.evidenceRows.push(this.scanLocally ? redactEvidence(parsed).evidence : parsed);
    return this;
  }

  qualitySample(draft: Omit<QualitySampleInput, 'id' | 'workloadId'> & { id?: string }): this {
    this.quality.push({
      ...draft,
      id: draft.id ?? id('qs'),
      workloadId: this.workloadId,
      traceId: this.traceId,
    });
    return this;
  }

  async close(
    outcome: TraceClose['outcome'],
    extra: Partial<Omit<TraceClose, 'traceId' | 'workloadId' | 'outcome'>> = {},
  ): Promise<IngestResponse> {
    this.closed = {
      traceId: this.traceId,
      workloadId: this.workloadId,
      outcome,
      retries: extra.retries ?? 0,
      escalatedToHuman: extra.escalatedToHuman ?? false,
      actorId: extra.actorId,
      endedAt: extra.endedAt ?? Date.now(),
    };
    return this.flush();
  }

  /**
   * Send everything buffered.
   *
   * Waits (bounded by `pendingTimeoutMs`) for in-flight recordings first. An
   * empty buffer is not posted — Control would reject it, and there is
   * nothing to say. A batch larger than the ingest caps is sent in chunks.
   * If a POST fails, everything not yet accepted goes back into the buffer
   * before the error is rethrown, so a later flush can retry it; ids make the
   * retry idempotent.
   */
  async flush(): Promise<IngestResponse> {
    await this.settlePending();

    const traces = this.closed ? [this.closed] : [];
    if (
      this.events.length === 0 &&
      traces.length === 0 &&
      this.actions.length === 0 &&
      this.quality.length === 0 &&
      this.evidenceRows.length === 0
    ) {
      return emptyResponse();
    }

    let events = this.events;
    let actions = this.actions;
    let quality = this.quality;
    let evidence = this.evidenceRows;
    this.events = [];
    this.actions = [];
    this.quality = [];
    this.evidenceRows = [];

    let total = emptyResponse();
    let first = true;
    while (first || events.length || actions.length || quality.length || evidence.length) {
      // The trace close rides on the last chunk, after every event it totals.
      const last =
        events.length <= INGEST_MAX_EVENTS &&
        actions.length <= INGEST_MAX_ROWS &&
        quality.length <= INGEST_MAX_ROWS &&
        evidence.length <= INGEST_MAX_ROWS;
      const body = {
        events: events.slice(0, INGEST_MAX_EVENTS),
        traces: last ? traces : [],
        actions: actions.slice(0, INGEST_MAX_ROWS),
        qualitySamples: quality.slice(0, INGEST_MAX_ROWS),
        evidence: evidence.slice(0, INGEST_MAX_ROWS),
      };
      try {
        total = mergeResponses(total, await this.client.ingest(body));
        if (last && this.closed === traces[0]) this.closed = null;
      } catch (err) {
        this.events = [...events, ...this.events];
        this.actions = [...actions, ...this.actions];
        this.quality = [...quality, ...this.quality];
        this.evidenceRows = [...evidence, ...this.evidenceRows];
        throw err;
      }
      events = events.slice(INGEST_MAX_EVENTS);
      actions = actions.slice(INGEST_MAX_ROWS);
      quality = quality.slice(INGEST_MAX_ROWS);
      evidence = evidence.slice(INGEST_MAX_ROWS);
      first = false;
    }
    return total;
  }

  private async settlePending(): Promise<void> {
    if (this.pending.size === 0) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<void>((resolve) => {
      timer = setTimeout(resolve, this.pendingTimeoutMs);
    });
    try {
      await Promise.race([Promise.allSettled([...this.pending]), timeout]);
    } finally {
      clearTimeout(timer);
    }
  }
}

function emptyResponse(): IngestResponse {
  return { accepted: 0, tracesClosed: 0, priced: 0, unpriced: 0, alerts: 0, circuitBreaks: [] };
}

function mergeResponses(a: IngestResponse, b: IngestResponse): IngestResponse {
  const add = (x?: number, y?: number) => (x === undefined && y === undefined ? undefined : (x ?? 0) + (y ?? 0));
  const out: IngestResponse = {
    ...a,
    ...b,
    accepted: (a.accepted ?? 0) + (b.accepted ?? 0),
    tracesClosed: (a.tracesClosed ?? 0) + (b.tracesClosed ?? 0),
    priced: (a.priced ?? 0) + (b.priced ?? 0),
    unpriced: (a.unpriced ?? 0) + (b.unpriced ?? 0),
    alerts: (a.alerts ?? 0) + (b.alerts ?? 0),
    circuitBreaks: [...(a.circuitBreaks ?? []), ...(b.circuitBreaks ?? [])],
  };
  for (const k of ['actionsAccepted', 'qualityAccepted', 'evidenceAccepted'] as const) {
    const v = add(a[k], b[k]);
    if (v !== undefined) out[k] = v;
  }
  if (a.evidenceRedacted || b.evidenceRedacted) {
    out.evidenceRedacted = [...new Set([...(a.evidenceRedacted ?? []), ...(b.evidenceRedacted ?? [])])];
  }
  return out;
}

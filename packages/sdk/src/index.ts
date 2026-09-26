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
} from '@ark/core';
import { activeTrace, hrefOf, isControlIngestUrl, observeLlmCall } from './instrument.js';

export { observeLlmCall, isControlIngestUrl } from './instrument.js';

export interface ArkClientOptions {
  /** Origin of ARK Control, e.g. http://localhost:3002 */
  baseUrl: string;
  token?: string;
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
    return new TraceHandle(this, workloadId, traceId, this.opts.scanLocally !== false);
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
    opts?: { traceId?: string },
  ): Promise<T> {
    const trace = this.trace(workloadId, opts?.traceId);
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
      try {
        const requestBody = typeof init?.body === 'string' ? init.body : undefined;
        const responseBody = await res.clone().text();
        const draft = observeLlmCall({
          url,
          requestBody,
          responseBody,
          latencyMs: Date.now() - started,
          status: res.status,
        });
        if (draft) handle.event(draft);
      } catch {
        // Fail open. The user already has their response.
      }
      return res;
    };
  }

  async ingest(body: unknown): Promise<IngestResponse> {
    const parsed = IngestBody.parse({ orgId: this.opts.orgId ?? 'org_demo', ...(body as object) });
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
      return res.json() as Promise<IngestResponse>;
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

  constructor(
    private readonly client: ArkIngest,
    readonly workloadId: string,
    readonly traceId: string,
    private readonly scanLocally: boolean,
  ) {}

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
      sensitiveMatches = detectSensitive(sample);
      sample = undefined;
    }
    const parsed = EventInput.parse({
      ...draft,
      sample,
      sensitiveMatches,
      id: draft.id ?? id('ev'),
      traceId: this.traceId,
      workloadId: this.workloadId,
      turn,
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
    const parsed = EvidenceInput.parse({
      ...observation,
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

  async flush(): Promise<IngestResponse> {
    const body = {
      events: this.events,
      traces: this.closed ? [this.closed] : [],
      actions: this.actions,
      qualitySamples: this.quality,
      evidence: this.evidenceRows,
    };
    this.events = [];
    this.actions = [];
    this.quality = [];
    this.evidenceRows = [];
    return this.client.ingest(body);
  }
}

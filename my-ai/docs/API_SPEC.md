# API Specification

## Storage and retention

Sessions, scores, and share snapshots are written to a key-value store:

- **Redis** (Upstash / Vercel KV REST) when `UPSTASH_REDIS_REST_URL` + `UPSTASH_REDIS_REST_TOKEN`
  (or `KV_REST_API_URL` + `KV_REST_API_TOKEN`) are set — every key has a 30-day `EX`.
- Otherwise the **server's disk** under `MYAI_STORE` (default `/tmp/myai-store`), one JSON
  file per record, written atomically. Files older than 30 days are deleted on read and by an
  hourly sweep.

The store is the source of truth; there is no long-lived process cache, so a delete is seen
by every API instance. A short (10 minute), bounded in-memory copy is kept only for a write
the backend refused. Feedback (last 1000 rows) and analytics counters (last 5000 events) are
in process memory only and are never written to disk.

## Identifiers and limits

- Session and share ids are UUIDs. Any other id in a path or body is rejected (`422`).
- Request bodies are capped at 1 MB (`413`). Event batches hold at most 50 events, a session
  at most 500; free text and comments at most 2000 characters.
- `POST /v1/share`, `POST /v1/sessions/{id}/share`, `POST /v1/score` and
  `POST /v1/sessions/{id}/score` are rate limited per client IP (defaults 20 and 60 per minute,
  `MYAI_SHARE_RATE_PER_MIN` / `MYAI_SCORE_RATE_PER_MIN`; `429` when exceeded). `X-Forwarded-For`
  is honoured only from a loopback peer (the consumer app's proxy).

## MVP endpoints

### GET /health
Basic health.

### GET /v1/scenarios
Returns active assessment scenarios.

### POST /v1/sessions
Creates an assessment session.

### POST /v1/sessions/{id}/events
Adds normalized/raw interaction events. `404` for an unknown or deleted session (create it
with `POST /v1/sessions` first).

### POST /v1/sessions/{id}/score
Scores current session.

### GET /v1/registry/products
Lists product registry.

### GET /v1/registry/models
Lists model registry.

### POST /v1/fit
Accepts a user fit vector and returns ranked products/models.

### POST /v1/persona
Generates a portable persona payload from metrics.

### POST /v1/sessions/demo
Loads the sample session, scores it, and returns `{session_id, result}`.

### POST /v1/sessions/{id}/share
Stores an anonymous score snapshot (no raw prompts), linked to the session.

### POST /v1/share
Body `{result, session_id?}`. Stores a snapshot of a scored `result` (the client's copy).
Missing result fields are a `400`. Pass `session_id` so deleting the session deletes the share.

### GET /v1/share/{share_id}
Returns that snapshot.

### GET /v1/sessions/{id}/export
Exports the anonymous session record.

### DELETE /v1/sessions/{id}
Deletes the session's events, its scores, and every share snapshot created from it
(`POST /v1/sessions/{id}/share`, or `POST /v1/share` with that `session_id`). The session id
is also removed from in-memory feedback rows and analytics events. Returns
`{deleted, session_id, shares_deleted}`. A share published without a `session_id` is not
linked and expires after 30 days.

### POST /v1/score
Stateless scoring of `{session_id, events, filters}`; the result is stored under that session id.

### POST /v1/classify
Keyword (and optional LLM) event labels. Not a recommendation.

### GET /v1/registry/freshness
Age bands. Stale rows lose confidence.

### POST /v1/feedback
1–5 rating and optional comment. No identity fields.

### GET /v1/analytics/summary
Anonymous in-memory event counts (current process only).


## Response requirement

Recommendation objects must include:

```json
{
  "id": "...",
  "name": "...",
  "fit": 0.87,
  "confidence": 0.82,
  "positive_factors": [],
  "negative_factors": [],
  "last_evaluated_at": "..."
}
```

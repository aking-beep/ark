# ADR-0003: AIFit stores nothing; intake travels in the URL

**Status:** Accepted
**Date:** 2026-09-14

## Context

Both AIFit surfaces need a shareable result. The user answers questions, gets a report, and wants to send it to a colleague or open it again tomorrow.

The default implementation is a row in a database and a short id in the URL. It is easy, it is what everyone does, and it gives you analytics for free.

It also means a consumer tool that asks "what do you do all day, how long does it take, and what does your company pay you" keeps a copy. And the business intake is worse: it collects data classes in scope, regulatory regimes, action surface, team size and security posture. That is a description of an organisation's soft spots, sitting in a database belonging to a company with no security program, in exchange for a free assessment.

## Decision

Neither AIFit surface persists anything. The intake is zod-validated, JSON-serialised, base64url-encoded, and carried in the `w` query parameter. The report page decodes it, runs `assess()`, and returns HTML. Nothing is written.

Assessment pages are `force-dynamic` server components. A corrupt or truncated parameter fails `safeParse` and renders a recovery panel rather than a stack trace.

## Consequences

**Good.**

- The privacy claim is structural rather than a policy. "We don't keep it" is checked by the absence of a database, not by a paragraph.
- No breach surface, no retention policy, no deletion endpoint, no data processing agreement, no subject access request handling. For a product whose entire pitch is honesty about what it knows, not knowing anything is a strong position.
- Links are portable and permanent without infrastructure. They keep working across deploys because there is no row to migrate.
- Re-running on every view means a report always reflects the current rubric and the current calibration. A stored report would be a `measured` label on a measurement that has since moved.

**Bad.**

- **No product analytics from the intake.** Funnel data has to come from page events, not from answers. This is a genuine cost and it is accepted deliberately — the alternative is building the thing the ADR exists to prevent.
- **URL length.** Encoded intakes run ~1.5–3 KB against a ~8 KB practical request-line limit at most proxies. Comfortable, but it is a real ceiling and a reason the business intake cannot grow without bound. Documented in `apps/business/src/lib/encode.ts`.
- **The link contains the answers.** Base64url is encoding, not encryption. A user forwarding a report link is forwarding the intake. This is stated in the footer of both surfaces rather than buried, because a user who thinks the link is opaque will share it more freely than one who knows.
- **Recomputation on every view.** Cheap — the engine is pure synchronous TypeScript — but it does mean the calibration fetch happens per view. Mitigated by caching the calibration *endpoint* (`max-age=60`), not the assessment.

## Alternatives considered

**Store with a TTL.** Rejected: a 30-day retention window still requires every piece of machinery a permanent store requires, and "we delete it eventually" is a materially weaker claim than "we never had it."

**Client-side storage.** Rejected: not shareable, which was the requirement.

**Encrypt the payload with a server key.** Rejected: it would prevent forwarded links from leaking the intake, but it makes the server a necessary party to decoding and reintroduces key management for a benefit the footer disclosure already delivers.

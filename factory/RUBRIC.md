# The review rubric

Five criteria, one point each, scored by the reviewer in
[step 4](04-SHIP.md). **A point is awarded or it is not — there are no halves and
no "mostly."** Partial credit is how a 5/5 gate becomes a 4/5 gate within a month.

The score is recorded in `evidence/<slug>/REVIEW.md`, one block per round.

---

## 1. It does what the spec said

The acceptance criteria in `specs/<slug>.md` are met — all of them, as written,
not as the builder reinterpreted them mid-build.

**Withhold the point if:** any criterion is unmet; the builder changed the scope
without the change being declared in `EVIDENCE.md`; the feature does something
substantial the spec did not ask for. Scope added silently is scope no one
approved, and it is reviewed by no one.

## 2. The evidence proves it

`evidence/<slug>/` contains a before artifact and an after artifact, measured the
same way, and they demonstrate the change to someone who has not read the diff.

**Withhold the point if:** the before state was reconstructed after the fact;
before and after were measured differently (different viewport, different data,
different machine) so the comparison is not a comparison; the only evidence is
passing tests; the "what this does not prove" line is empty or evasive. See
[step 3](03-PROVE.md) for what counts.

## 3. The structure holds

The code obeys the layer rule in [`02-BUILD.md`](02-BUILD.md): edge calls
service, service calls adapter, and nothing points back up.

**Withhold the point if:** an edge file touches a database or provider client
directly; a service imports a framework request or response type; a third-party
client is constructed outside an adapter; a new dependency appears that the spec
did not authorize and `EVIDENCE.md` did not declare.

## 4. It fails safely

The failure modes a user or an operator will actually hit are handled, and the
handling is visible.

**Withhold the point if:** a new external call has no timeout; an error is caught
and swallowed; a failure surfaces to the user as a hang, a blank screen, or a
raw stack trace; a partial write can leave state inconsistent with no way back;
input crossing a trust boundary is unvalidated. For AI-specific work, also
withhold if a model call has no fallback path and no cost ceiling.

## 5. The next person can read it

A developer who was not here can open the diff and understand it without the
build transcript.

**Withhold the point if:** names mislead; a non-obvious decision has no comment
explaining *why* (comments explaining *what* the line does are noise and do not
earn the point either); the change is scattered across files for no reason a
reader can infer; there are no tests for the logic that matters; dead code,
commented-out code, or debug output ships.

---

## Scoring blocks

```markdown
## Round 1 — 2026-09-14 — 3/5

| # | Criterion | Point | Finding |
|---|---|---|---|
| 1 | Spec satisfied | ✅ | All four criteria met. |
| 2 | Evidence proves it | ✅ | Before/after at 1440px, same route. |
| 3 | Structure holds | ❌ | `app/api/upload/route.ts:34` queries `db` directly. Move to `services/upload.ts`. |
| 4 | Fails safely | ❌ | `fetch` to the storage provider has no timeout; a hung provider hangs the request. |
| 5 | Readable | ✅ | — |

**Blocking:** criteria 3 and 4.
**Non-blocking:** `EVIDENCE.md` would be stronger with the p95, not just the mean.
```

## Rules for the reviewer

**Findings name a file and a line.** "Consider improving error handling" is not a
finding; it cannot be fixed and it cannot be verified as fixed.

**Blocking and non-blocking are different lists.** Everything that cost a point
is blocking, by definition. Everything else is a note, and the builder is free to
ignore it. A reviewer who marks preferences as blocking will be routed around.

**Do not rewrite the code.** The reviewer says what is wrong and where. The
builder fixes it. A reviewer who patches the diff has just reviewed its own work
in the next round.

**Score the round in front of you.** Not the trend, not the builder's effort, not
how many rounds this has taken. Round four scores exactly the way round one did.

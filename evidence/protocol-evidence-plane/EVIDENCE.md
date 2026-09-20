# Evidence — protocol-evidence-plane

## What changed

One sentence, in user terms. Not "refactored the upload handler" but "files over
10 MB now fail with a message instead of hanging." TODO

## How it was measured

The exact command, route, viewport, or procedure — such that a reviewer could
repeat it and get the same thing. State the conditions that would change the
result: data set, machine, warm or cold cache. TODO

## Before / after

| | Before | After |
|---|---|---|
| Artefact | `before.png` | `after.png` |
| Measurement | TODO | TODO |

Capture timestamps and commit SHAs are in `captures.tsv`, written by
`scripts/factory-prove.sh`.

## What this does not prove

The honest limit. One browser only. Happy path only. Mocked provider. Seeded
data, not production shapes. Load untested.

This line is what earns trust in everything above it — an evidence document that
claims to prove everything is a document to distrust. TODO

## Deviations

Anything done differently from the spec, and why. Any dependency added that the
spec did not authorize, and what it replaced. Any test changed, and why the old
one was wrong. If none: say "none".

## Definition of done

Items from `factory/DEFINITION_OF_DONE.md` that need a written answer here.
"Not applicable" is legitimate **with a reason**; "not applicable" because nobody
measured is the failure the list exists to prevent.

- **Cost / latency impact:** TODO
- **Observability for new failure modes:** TODO
- **Docs or ADR updated:** TODO

# Definition of done

The [rubric](RUBRIC.md) governs a single feature at review time. This is the
wider bar — the things that must be true before a feature is considered finished,
several of which the rubric cannot see.

A feature is done only when:

- acceptance criteria in `specs/<slug>.md` pass
- unit, integration, and end-to-end coverage appropriate to the risk exists
- AI behaviour, where present, has regression and safety evaluation coverage
- authorization and privacy implications have been reviewed
- no new unresolved critical or high security finding
- latency and AI/cloud cost impact are measured, or explicitly marked not
  applicable with a reason
- observability exists for the new failure modes
- documentation or an ADR is updated when the architecture changed
- rollback is understood and stated
- staging evidence passes
- production release has human approval

## How this relates to the rubric

Rubric criterion 4 ("it fails safely") and this list overlap deliberately, and
the overlap is not duplication: the rubric is what a reviewer can assess from a
diff and an evidence directory in ten minutes, and this is what must be true
before the thing reaches users. A feature can score 5/5 and still not be done,
because the reviewer cannot see whether staging passed or whether anyone is
watching the new error path in production.

Items here that no reviewer can verify from a diff are enforced by the required
gates in [`GOVERNANCE.md`](GOVERNANCE.md).

## Marking an item not applicable

"Not applicable" is a legitimate answer for most of these on most features. It is
only legitimate **in writing, with a reason**, in `EVIDENCE.md`. A cost impact
marked N/A because the feature adds no model call and no new query is fine. One
marked N/A because nobody measured is the failure this list exists to prevent.

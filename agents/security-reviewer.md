# Security reviewer

A separate pass from the [general review](reviewer.md), run under the
[governance layer](../factory/GOVERNANCE.md) and on any feature that touches
authentication, authorization, user data, payments, credentials, model calls with
user input, or infrastructure permissions.

It is separate because a reviewer scoring five general criteria will catch a
missing timeout and will not catch an authorization check that is one role too
permissive. Different question, different attention.

## Inputs

The diff, the spec, and the repo's threat model if it has one. You do not need
the evidence directory — you are not assessing whether the feature works.

## What you look for

**Authorization.** Who can call this, and who checked? Every new endpoint,
action, or query path needs an explicit answer. The dangerous case is the one
where the check exists but is coarser than the resource — a check for "is a
member of the org" on a route that returns a specific user's record.

**Data handling.** What leaves the process, and where does it land? Logs,
telemetry, model providers, third-party APIs, error trackers. Personal data in a
log line is a breach that looks like debugging. Prompts sent to a provider are
data leaving the building.

**Secrets.** Nothing in code, in the diff, in test fixtures, in evidence
artifacts, or in error messages. New environment variables documented in the
repo's env example with no real value beside them.

**Injection and trust boundaries.** Input crossing a boundary is untrusted:
request bodies, query params, file contents, webhook payloads, model output.
Model output in particular — it is untrusted input that arrives looking like an
answer, and anything that routes it into a query, a shell, a template, or a tool
call needs the same treatment as a form field.

**Dependencies.** Anything new: what is it, who maintains it, what does it pull
in, and does the repo already do this job somewhere?

**Privilege.** IAM changes, new roles, broadened scopes, new network paths. Note
anything that widens what a compromised component could reach.

**AI-specific.** Cost ceiling on every model call. Timeout and fallback path. No
credentials or full user records in prompts. A stated answer to what happens when
the provider returns nonsense, since it will.

## Output

`evidence/<slug>/SECURITY.md`: findings at critical / high / medium / low, each
naming a file and line and a concrete remediation. A critical or high finding is
blocking regardless of the rubric score — the general reviewer's 5/5 does not
override it, and the two reviews are recorded separately so neither can be
mistaken for the other.

"No findings" is a legitimate output and should be written down as such, with the
list of what you checked. A security review that leaves no record is
indistinguishable from one that never happened.

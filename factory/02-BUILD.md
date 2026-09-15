# Step 2 — Build

**Rule: the agent writes to a stated structure, so that a human developer can
read the result without reading the transcript that produced it.**

An unconstrained agent writes code that works. It will put business logic in a
route handler, call the database from a component, invent a third way to format
a date, and reach for a new dependency rather than the one already installed. No
single instance of this is a problem. Two hundred of them, accumulated in a week
of parallel agents, is a codebase no one wants to touch — and you cannot review
your way out of it after the fact, because every individual diff looked fine.

The structure below is the default. A repo that needs a different one states it
in its own `factory/PROJECT.md` and that file wins; what is not allowed is
having no answer.

## The layer rule

Three layers, and dependencies point one direction only.

```
edge        HTTP routes, CLI entrypoints, UI components, jobs, webhooks
   ↓        parses input, calls exactly one service function, renders the result
service     the business logic — the part worth testing and the part worth reading
   ↓        pure where possible; takes and returns typed values, not framework objects
adapter     database, model providers, mail, storage, any third-party API
```

**Edge never talks to an adapter.** A route that queries the database directly
is the single most common structural failure and the one that costs most later,
because the logic inside it cannot be tested without standing up a web server
and cannot be reused without an HTTP call.

**Services do not import framework types.** No `Request`, no `Response`, no
`NextRequest`, no router context. A service that takes a typed argument and
returns a typed value can be called from a route, a CLI, a test, a queue worker,
or another service. One that takes a `Request` can be called from one place.

**Adapters are the only place a third-party client is constructed.** One module
owns the database client; one owns each model provider. When a provider changes
its SDK, or you need to add a timeout, or someone asks what data leaves the
building, the answer is in one file.

## Rules that survive contact with agents

These are written as instructions to whatever is doing the building.

1. **Smallest implementation that satisfies the spec.** Not the most general, not
   the most configurable, not the one that anticipates next quarter. Generality
   added before a second caller exists is a guess dressed as architecture.
2. **No new dependency without saying so.** If the spec did not authorize it,
   name it in the evidence and say what it replaced. "It was already in the
   lockfile" is not authorization — transitive presence is not a decision.
3. **Deterministic logic over model logic wherever both would work.** A regex, a
   lookup table, or a comparison is testable, free, and the same tomorrow. Do
   not call a model to decide something an `if` can decide.
4. **Errors are handled where they can be answered.** Catch at the layer that can
   do something about it. A `catch` that logs and rethrows is noise; a `catch`
   that swallows is a bug with a hiding place.
5. **No secrets, no tokens, no credentials in code or in the diff.** Read from
   env, document the variable in the repo's env example, and never print it.
6. **Tests live with the thing they test and are written in the same pass.**
   Tests added afterward test what the code does. Tests written alongside test
   what the spec said.
7. **State deviations out loud.** If the spec's approach was wrong and you did
   something else, that belongs in `EVIDENCE.md` where a reviewer will see it,
   not in a commit message where they will not.

## Commits

Commit at each working state, not at the end. The branch is disposable but the
history is what a reviewer bisects when the evidence disagrees with the diff.
Messages say what changed and why, in that order, in a sentence.

## What "done building" means

Building is done when the spec's acceptance criteria are met, the tests you wrote
pass, the repo's own typecheck and lint pass in the worktree, and you can state
in one sentence what a user can now do that they could not do before.

That sentence is the input to [step 3](03-PROVE.md). If you cannot write it, the
feature is not finished — it is merely coded.

# Harness adapters

The factory is markdown and four scripts, and it runs with no adapter at all —
point any model at `factory/CONTRACT.md` and it can execute the four steps. These
adapters exist so the harnesses you actually use load the right document at the
right moment without being asked.

**Every adapter is a loader.** None of them restates a rule. That is deliberate:
the moment an adapter carries its own copy of the build rules, the copies drift,
and the version that reaches the agent depends on which editor happened to be
open. If you change a rule, you change it in `factory/` and no adapter needs
touching.

## Claude Code / Cowork

```bash
mkdir -p .claude/skills .claude/agents
cp -r harness/claude-code/skills/software-factory .claude/skills/
cp harness/claude-code/agents/*.md .claude/agents/
```

`software-factory` is the routing skill — it maps what you ask for onto the step
document and the script. `factory-builder` and `factory-reviewer` are subagents;
the reviewer exists as a subagent specifically so it gets a clean context, which
is the invariant this harness makes easiest to break.

There is no `factory-prover` subagent. Proving happens inside the builder's
station, against a running dev server, and splitting it into a second context
buys nothing but a handoff.

## Cursor

```bash
mkdir -p .cursor/rules
cp harness/cursor/factory.mdc .cursor/rules/
```

`alwaysApply: true` puts the loader in front of every request in the repo. The
rule's job is mostly to stop the two failures Cursor invites: editing the root
checkout while a station is open, and reviewing your own diff in the chat that
wrote it.

Cursor has no subagent primitive, so the reviewer is a new chat given three
inputs — the spec, the diff, and `evidence/<slug>/` — plus `agents/reviewer.md`.
Opening that chat in the *root* checkout rather than the station keeps it from
wandering into the build.

## Anything else

Point the tool at `factory/CONTRACT.md` and let it follow the links. The four
step documents are written to be executable by a reader with no adapter, which is
the property that makes the factory portable — and the reason no adapter is
allowed to become the place a rule actually lives.

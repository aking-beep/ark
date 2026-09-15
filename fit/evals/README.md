# Eval harness

Cases in `evals/cases/` are scored against the deterministic engine. They do not
promote registry rows. Human review is still required before treating seed
evidence as launch-ready.

```bash
PYTHONPATH=packages/core/src python -m evals.harness validate-seed
PYTHONPATH=packages/core/src python -m evals.harness run-cases
PYTHONPATH=packages/core/src python -m evals.harness init-run ollama ollama coding
```

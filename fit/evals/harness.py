"""Provider-neutral evaluation harness.

Records dated run metadata. Does not write registry updates automatically.
"""

from __future__ import annotations

import json
from datetime import date
from pathlib import Path

import typer
from rich.console import Console

from aifit.engine import repo_root, score_session
from aifit.models import AssessmentSession, FitFilters
from aifit.registry import load_models, load_products, validate_models, validate_products

app = typer.Typer(no_args_is_help=True)
console = Console()


def _evals_root() -> Path:
    return repo_root() / "evals"


@app.command("init-run")
def init_run(provider: str, target: str, workload: str, evaluator: str = "human"):
    """Create a dated evaluation run stub that still requires human review."""
    day = date.today().isoformat()
    run_dir = _evals_root() / "runs" / f"{day}-{provider}-{target}"
    run_dir.mkdir(parents=True, exist_ok=True)
    payload = {
        "provider": provider,
        "product_or_model": target,
        "workload": workload,
        "date": day,
        "settings": {},
        "evaluator": evaluator,
        "raw_outputs": [],
        "rubric_scores": {},
        "human_review": None,
        "notes": "Do not promote this run into the registry until human_review is recorded.",
        "promoted_to_registry": False,
    }
    path = run_dir / "run.json"
    path.write_text(json.dumps(payload, indent=2) + "\n")
    console.print(f"Wrote {path}")


@app.command("validate-seed")
def validate_seed():
    root = repo_root()
    products = load_products(root / "data/registry/products.json")
    models = load_models(root / "data/registry/models.json")
    errors = validate_products(products) + validate_models(models)
    if errors:
        for error in errors:
            console.print(f"[red]{error}[/red]")
        raise typer.Exit(1)
    console.print(f"[green]{len(products)} products, {len(models)} models, all dated and evidenced.[/green]")


@app.command("run-cases")
def run_cases():
    """Score fixture cases. Every case must assert something, or the run fails."""
    root = repo_root()
    products = {p.id: p for p in load_products(root / "data/registry/products.json")}
    failures: list[str] = []
    checked = 0
    for path in sorted((_evals_root() / "cases").glob("*.json")):
        case = json.loads(path.read_text())
        session_file = case.get("session_file", "examples/sample_session.json")
        session = AssessmentSession.model_validate_json((root / session_file).read_text())
        filters = FitFilters(**case["filters"]) if case.get("filters") else None
        result = score_session(session, filters=filters)
        expect = case.get("expect") or {}
        if not expect:
            failures.append(f"{case.get('id', path.name)}: no expect block, so this case asserts nothing")
            continue
        checked += 1
        metrics = {m["name"]: m["score"] for m in result["metrics"]}
        if "min_source_demand" in expect and metrics.get("evidence_seeking", 0) < expect["min_source_demand"]:
            failures.append(f"{case['id']}: evidence_seeking too low")
        for metric, floor in (expect.get("min_metric") or {}).items():
            if metrics.get(metric, 0) < floor:
                failures.append(f"{case['id']}: {metric} {metrics.get(metric, 0):.2f} below {floor}")
        if expect.get("stack_ids_include") and not result["primary_stack"]["slots"]:
            failures.append(f"{case['id']}: missing primary stack slots")
        ranked_categories = {rec.get("category") for rec in result["products"]}
        for category in expect.get("categories_include") or []:
            if category not in ranked_categories:
                failures.append(f"{case['id']}: no {category} product in the ranked list")
        filled_roles = {
            slot["role"] for slot in result.get("operating_stack") or [] if slot.get("product")
        }
        for role in expect.get("stack_roles_filled") or []:
            if role not in filled_roles:
                failures.append(f"{case['id']}: stack role {role} stayed empty")
        if expect.get("no_cloud_only_products"):
            for rec in result["products"]:
                deployment = set(products[rec["id"]].deployment)
                if not deployment & {"local", "self_hosted", "on_prem"}:
                    failures.append(f"{case['id']}: cloud product {rec['id']} survived local_only")
    if failures:
        for row in failures:
            console.print(f"[red]{row}[/red]")
        raise typer.Exit(1)
    console.print(f"[green]{checked} eval cases passed.[/green]")


if __name__ == "__main__":
    app()

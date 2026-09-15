from __future__ import annotations

import json
from pathlib import Path

import typer
from rich.console import Console
from rich.table import Table

from .engine import registry_errors, repo_root, score_session
from .exports import export_persona
from .freshness import freshness_report
from .models import AssessmentSession
from .registry import load_models, load_products

app = typer.Typer(no_args_is_help=True)
console = Console()


@app.command()
def score(session_file: str):
    """Score an assessment session and print recommendations."""
    session = AssessmentSession.model_validate(json.loads(Path(session_file).read_text()))
    result = score_session(session)

    table = Table(title="Interaction Metrics")
    table.add_column("Metric")
    table.add_column("Score")
    table.add_column("Confidence")
    for metric in result["metrics"]:
        table.add_row(metric["name"], f"{metric['score']:.2f}", f"{metric['confidence']:.2f}")
    console.print(table)

    ptable = Table(title="Operating stack")
    ptable.add_column("Role")
    ptable.add_column("Product")
    for slot in result.get("operating_stack") or []:
        product = slot.get("product") or {}
        ptable.add_row(slot["label"], product.get("name") or "—")
    console.print(ptable)

    workstyle = result.get("workstyle") or {}
    maturity = (workstyle.get("maturity") or {})
    console.print(f"[bold]{workstyle.get('label')}[/bold]")
    if workstyle.get("narrative"):
        console.print(workstyle["narrative"])
    console.print(f"Fit score {maturity.get('score')} ({maturity.get('band')})")

    for row in result.get("model_routing") or []:
        model = row.get("model") or {}
        if model:
            console.print(f"[bold]{row['work']}[/bold]: {model.get('name')}")

    console.print("\n[bold]Persona[/bold]")
    console.print_json(data=result["persona"])


@app.command()
def export(session_file: str, target: str = "generic"):
    """Write a persona export from a scored session."""
    session = AssessmentSession.model_validate(json.loads(Path(session_file).read_text()))
    result = score_session(session)
    if target == "pack":
        from .exports import export_pack_zip

        filename, blob = export_pack_zip(result)
        Path(filename).write_bytes(blob)
        console.print(f"Wrote {filename}")
        return
    filename, body = export_persona(result["persona"], target, result)
    Path(filename).write_text(body)
    console.print(f"Wrote {filename}")


@app.command("validate-registry")
def validate_registry():
    """Validate product and model registry files."""
    errors = registry_errors()
    total = len(errors["products"]) + len(errors["models"])
    if total == 0:
        console.print("[green]Registry valid.[/green]")
        raise typer.Exit(0)
    for kind, rows in errors.items():
        for row in rows:
            console.print(f"[red]{kind}[/red] {row}")
    raise typer.Exit(1)


@app.command("freshness")
def freshness():
    """Show registry age bands. Stale records lose confidence, not rank-as-bad."""
    root = repo_root()
    report = freshness_report(
        load_products(root / "data/registry/products.json"),
        load_models(root / "data/registry/models.json"),
    )
    console.print_json(data=report)


@app.command()
def root():
    """Print the detected repository root."""
    console.print(str(repo_root()))


if __name__ == "__main__":
    app()

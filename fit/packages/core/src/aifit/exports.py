from __future__ import annotations

import json
from io import BytesIO
from zipfile import ZIP_DEFLATED, ZipFile

from .models import UserFitVector
from .profile import default_instructions


def persona_to_markdown(persona: dict, heading: str = "AI Working Configuration") -> str:
    sections = [
        (heading, None),
        (None, persona.get("purpose", "")),
        ("Characteristics", persona.get("traits", [])),
        ("Interaction rules", persona.get("interaction_rules", [])),
        ("Response rules", persona.get("response_rules", [])),
        ("Decision rules", persona.get("decision_rules", [])),
        ("Tool rules", persona.get("tool_rules", [])),
        ("Avoid", persona.get("avoid", [])),
    ]
    lines: list[str] = []
    for title, body in sections:
        if title and body is None:
            lines += [f"# {title}", ""]
            continue
        if isinstance(body, str):
            if body:
                lines += [body, ""]
            continue
        if not body:
            continue
        lines += [f"## {title}"]
        for item in body:
            lines.append(f"- {item}")
        lines.append("")
    lines.append(f"> {persona.get('disclaimer', '')}")
    lines.append("")
    lines.append("Edit these rules. They are a working configuration, not a psychological profile.")
    return "\n".join(lines) + "\n"


def profile_markdown(result: dict) -> str:
    workstyle = result.get("workstyle") or {}
    maturity = workstyle.get("maturity") or {}
    persona = result.get("persona") or {}
    lines = [
        f"# {workstyle.get('label') or persona.get('label') or 'AI Fit Profile'}",
        "",
        workstyle.get("narrative") or workstyle.get("summary") or persona.get("purpose") or "",
        "",
        f"Fit score: {maturity.get('score', '—')} ({maturity.get('band', 'unknown')})",
        "",
        "## Why this style",
    ]
    for reason in workstyle.get("why") or []:
        lines.append(f"- {reason.get('text', '')}")
        for quote in reason.get("evidence") or []:
            lines.append(f"  - {quote}")
    lines += ["", "## Interaction profile"]
    for dim in workstyle.get("dimensions") or []:
        display = dim.get("display", round(dim.get("score", 0) * 100))
        lines.append(f"- {dim['label']}: {display}")
    lines += ["", "## Stack"]
    for slot in result.get("operating_stack") or []:
        product = slot.get("product") or {}
        name = product.get("name") or "No strong match yet"
        handles = slot.get("handles") or ""
        lines.append(f"- {slot['label']}: {name}" + (f" — {handles}" if handles else ""))
    lines += ["", "## Model routing"]
    for row in result.get("model_routing") or []:
        model = row.get("model") or {}
        lines.append(f"- {row['work']}: {model.get('name') or 'n/a'}")
    lines += ["", "## Workflow"]
    for step in result.get("workflow") or []:
        mark = "*" if step.get("emphasis") else ""
        lines.append(f"- {step['label']}{mark}: {step.get('instruction', '')}")
    lines += ["", "## Default instructions", "", default_instructions(persona)]
    return "\n".join(lines)


def routing_json(result: dict) -> str:
    payload = {
        "workstyle": (result.get("workstyle") or {}).get("label"),
        "maturity": (result.get("workstyle") or {}).get("maturity"),
        "stack": result.get("operating_stack") or [],
        "routing": result.get("model_routing") or [],
        "disclaimer": result.get("disclaimer"),
    }
    return json.dumps(payload, indent=2)


def export_persona(persona: dict, target: str, result: dict | None = None) -> tuple[str, str]:
    result = result or {"persona": persona}
    if target == "json":
        return "ai-fit-profile.json", json.dumps({"persona": persona, **{k: result.get(k) for k in ("workstyle", "operating_stack", "model_routing")}}, indent=2)
    if target == "profile":
        return "PROFILE.md", profile_markdown(result)
    if target == "routing":
        return "model-routing.json", routing_json(result)
    if target == "chatgpt":
        return "chatgpt-instructions.md", persona_to_markdown(persona, "ChatGPT custom instructions")
    if target == "gemini":
        return "gemini-instructions.md", persona_to_markdown(persona, "Gemini Gem instructions")
    if target == "claude":
        return "CLAUDE.md", persona_to_markdown(persona, "Claude Working Configuration")
    if target == "agents":
        return "AGENTS.md", persona_to_markdown(persona, "Agent Working Configuration")
    if target == "cursor":
        body = persona_to_markdown(persona, "Fit Cursor Rule")
        return (
            ".cursor/rules/fit.mdc",
            "---\ndescription: Personalized Fit working rules\nalwaysApply: true\n---\n\n" + body,
        )
    return "persona.md", persona_to_markdown(persona)


def export_pack_files(result: dict) -> list[tuple[str, str]]:
    persona = result.get("persona") or {}
    files = [
        export_persona(persona, "profile", result),
        export_persona(persona, "claude", result),
        export_persona(persona, "agents", result),
        ("cursor-rules.md", export_persona(persona, "cursor", result)[1]),
        export_persona(persona, "chatgpt", result),
        export_persona(persona, "gemini", result),
        export_persona(persona, "routing", result),
    ]
    return files


def export_pack_zip(result: dict) -> tuple[str, bytes]:
    buffer = BytesIO()
    with ZipFile(buffer, "w", ZIP_DEFLATED) as archive:
        for filename, body in export_pack_files(result):
            archive.writestr(f"ai-profile/{filename}", body)
    return "ai-profile.zip", buffer.getvalue()


def export_profile(persona: dict, user: UserFitVector, target: str) -> tuple[str, str]:
    if target == "json":
        payload = {"persona": persona, "user_vector": user.model_dump()}
        return "ai-fit-profile.json", json.dumps(payload, indent=2)
    return export_persona(persona, target)

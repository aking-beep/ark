"""AI workstyle, stack roles, model router, workflow, install guides."""

from __future__ import annotations

from .models import MetricResult, Recommendation, UserFitVector

INTERACTION_PROFILE = (
    ("autonomy", "Hands-off help", ("autonomy_preference",)),
    ("verification", "Fact checking", ("assumption_challenge", "evidence_seeking")),
    ("iteration", "Tweaking", ("iteration_preference",)),
    ("context_depth", "Going deeper", ("depth_preference", "structure_preference")),
    ("tool_delegation", "Handing work off", ("automation_appetite", "integration_appetite")),
    ("source_dependency", "Wanting sources", ("evidence_seeking",)),
    ("exploration", "Comparing options", ("comparison_preference", "alternative_seeking")),
)

STACK_ROLES = (
    ("primary_assistant", "Everyday helper", ("general_assistant",)),
    ("research", "Looking things up", ("research", "knowledge")),
    ("coding", "Building things", ("coding_agent",)),
    ("ide", "In your editor", ("ide",)),
    ("automation", "Repeating chores", ("automation",)),
    ("creative", "Making things", ("writing", "image", "design", "presentation", "video")),
    ("local_private", "Keep it private", ("local_open_source",)),
)

ROUTER_WORKLOADS = (
    ("strategy", "Big decisions", "deep_reasoning"),
    ("research", "Looking it up", "research"),
    ("coding", "Building", "coding"),
    ("multimodal", "Pictures and media", "multimodal"),
    ("fast", "Quick questions", "fast_reasoning"),
    ("agents", "Hands-off help", "agentic_execution"),
    ("local", "Private / on-device", "local_control"),
)

MATURITY_KEYS = (
    "evidence_seeking",
    "comparison_preference",
    "iteration_preference",
    "assumption_challenge",
    "code_comfort",
    "automation_appetite",
    "integration_appetite",
)

INSTALL_GUIDES = (
    {
        "id": "chatgpt",
        "label": "ChatGPT",
        "export_target": "chatgpt",
        "filename": "chatgpt-instructions.md",
        "where": "ChatGPT → Personalization → Custom instructions",
        "steps": [
            "Open ChatGPT settings and choose Personalization.",
            "Paste into “How would you like ChatGPT to respond?”",
            "Save. Edit any line that does not match how you like to use AI.",
        ],
    },
    {
        "id": "claude",
        "label": "Claude",
        "export_target": "claude",
        "filename": "CLAUDE.md",
        "where": "Claude Project instructions, or CLAUDE.md in a repo",
        "steps": [
            "On Claude.ai: open a Project → Instructions → paste.",
            "In Claude Code: save as CLAUDE.md at the project root.",
            "Keep the file editable. This is a working config.",
        ],
    },
    {
        "id": "cursor",
        "label": "Cursor",
        "export_target": "cursor",
        "filename": ".cursor/rules/fit.mdc",
        "where": ".cursor/rules/fit.mdc",
        "steps": [
            "Create .cursor/rules/fit.mdc in the project.",
            "Paste the downloaded rule. alwaysApply is already set.",
            "Reload the window so Cursor picks it up.",
        ],
    },
    {
        "id": "gemini",
        "label": "Gemini",
        "export_target": "gemini",
        "filename": "gemini-instructions.md",
        "where": "Gemini Gems → Instructions",
        "steps": [
            "Create or edit a Gem.",
            "Paste the instructions into the Gem instructions field.",
            "Use that Gem for chats that should match this style.",
        ],
    },
    {
        "id": "agents",
        "label": "Agent system prompt",
        "export_target": "agents",
        "filename": "AGENTS.md",
        "where": "AGENTS.md or your agent runner’s system prompt",
        "steps": [
            "Save as AGENTS.md at the repo root, or paste into the agent system prompt.",
            "Point coding agents at the file so they inherit the same working rules.",
        ],
    },
)

_BEHAVIOR = {
    "autonomy": "you let AI take the next few steps instead of asking you every time",
    "verification": "you want claims checked and the working shown",
    "iteration": "you tweak the first draft instead of taking it as-is",
    "context_depth": "you prefer the real structure over a thin first answer",
    "tool_delegation": "you like handing repeating work to tools and automations",
    "source_dependency": "you want sources before treating a claim as settled",
    "exploration": "you compare options before you commit",
}


MIN_LABEL_CONFIDENCE = 0.45


def _mean(values: dict[str, float], keys: tuple[str, ...]) -> float | None:
    present = [values[key] for key in keys if key in values]
    if not present:
        return None
    return sum(present) / len(present)


def strong(
    values: dict[str, float],
    confidence: dict[str, float] | None,
    key: str,
    floor: float,
) -> bool:
    """A dimension only earns a label when it is both high and repeatedly observed.

    Metric scores are mean strength, so one strong answer looks identical to a
    persistent habit. Confidence carries the frequency, so labels need both.
    """
    if values.get(key, 0) < floor:
        return False
    if confidence is None:
        return True
    return confidence.get(key, 1.0) >= MIN_LABEL_CONFIDENCE


def workstyle_label(values: dict[str, float], confidence: dict[str, float] | None = None) -> str:
    evidence = strong(values, confidence, "evidence_seeking", 0.7)
    code = strong(values, confidence, "code_comfort", 0.6)
    automation = strong(values, confidence, "automation_appetite", 0.7)
    autonomy = values.get("autonomy_preference", 0)
    if evidence and autonomy >= 0.6:
        return "Careful Checker"
    if evidence and code:
        return "Careful Maker"
    if evidence and strong(values, confidence, "comparison_preference", 0.65):
        return "Side-by-side Thinker"
    if code and autonomy >= 0.65:
        return "Hands-on Maker"
    if automation:
        return "Automation Fan"
    if autonomy >= 0.7 and values.get("assumption_challenge", 0) < 0.45:
        return "Quick Mover"
    if strong(values, confidence, "multimodal_preference", 0.7):
        return "Creative Tweaker"
    if autonomy and autonomy <= 0.35:
        return "Check-with-me First"
    return "Flexible Partner"


def workstyle_narrative(values: dict[str, float], confidence: dict[str, float] | None = None) -> str:
    autonomy = values.get("autonomy_preference", 0.5)
    verified = strong(values, confidence, "assumption_challenge", 0.6) or strong(
        values, confidence, "evidence_seeking", 0.7
    )
    iteration = values.get("iteration_preference", 0.5)
    tools = max(values.get("automation_appetite", 0), values.get("integration_appetite", 0))
    if autonomy >= 0.6 and verified:
        return (
            "You like AI that can keep going on its own, then show its sources and pause before anything that really matters."
        )
    if autonomy >= 0.65 and strong(values, confidence, "code_comfort", 0.6):
        return "You like AI that actually builds the thing — a draft, a page, a working file — instead of only describing a plan."
    if autonomy >= 0.7 and not verified:
        return "You like AI that moves quickly, takes the next steps, and does not stop to ask extra permission."
    if autonomy <= 0.35 and verified:
        return "You like AI that stays easy to check, asks before big changes, and shows the evidence behind a recommendation."
    if tools >= 0.65 and iteration >= 0.6:
        return "You like AI that turns repeating chores into tools, then lets you tweak the result."
    if values.get("multimodal_preference", 0) >= 0.65:
        return "You like AI that can draft, picture, and revise in the same loop — not only plain text."
    return "You like AI that matches how deep you want to go, stays easy to check, and gives you a clear next step."


def workstyle_summary(values: dict[str, float]) -> str:
    bits: list[str] = []
    if values.get("evidence_seeking", 0) >= 0.6:
        bits.append("evidence-driven")
    if values.get("iteration_preference", 0) >= 0.6:
        bits.append("iterative")
    if values.get("automation_appetite", 0) >= 0.55 or values.get("integration_appetite", 0) >= 0.55:
        bits.append("tool-oriented")
    if values.get("autonomy_preference", 0) >= 0.65:
        bits.append("high autonomy")
    elif values.get("autonomy_preference", 0) <= 0.35:
        bits.append("confirm-first")
    if values.get("assumption_challenge", 0) >= 0.55 or values.get("evidence_seeking", 0) >= 0.7:
        bits.append("high verification")
    if not bits:
        bits = ["adaptive", "inspectable"]
    return ", ".join(bits)


def maturity(user: UserFitVector) -> dict:
    scores: list[float] = []
    confs: list[float] = []
    for key in MATURITY_KEYS:
        if key in user.values:
            scores.append(user.values[key])
            confs.append(user.confidence.get(key, 0.4))
    coverage = len(scores) / len(MATURITY_KEYS)
    mean_score = sum(scores) / len(scores) if scores else 0.0
    mean_conf = sum(confs) / len(confs) if confs else 0.0
    value = round(100 * ((mean_score * 0.45) + (mean_conf * 0.35) + (coverage * 0.20)))
    if value < 45:
        band = "getting started"
    elif value < 70:
        band = "getting comfortable"
    else:
        band = "really fluent"
    return {
        "score": value,
        "band": band,
        "coverage": round(coverage, 4),
        "note": "This score tracks how clearly we saw your habits. Retake it if your tools or routine change.",
    }


def interaction_profile(user: UserFitVector) -> list[dict]:
    rows: list[dict] = []
    for dim_id, label, keys in INTERACTION_PROFILE:
        score = _mean(user.values, keys)
        if score is None:
            continue
        conf = _mean(user.confidence, keys) or 0.0
        rows.append(
            {
                "id": dim_id,
                "label": label,
                "score": round(score, 4),
                "display": round(score * 100),
                "confidence": round(conf, 4),
            }
        )
    return rows


def workstyle_why(user: UserFitVector, metrics: list[MetricResult] | None = None) -> list[dict]:
    profile = interaction_profile(user)
    quotes = {metric.name: metric.evidence for metric in metrics or []}
    reasons: list[dict] = []
    ranked = sorted(profile, key=lambda row: row["score"], reverse=True)
    for row in ranked:
        if row["score"] < 0.58 and len(reasons) >= 2:
            continue
        behavior = _BEHAVIOR.get(row["id"], f"you show a strong {row['label'].lower()} preference")
        evidence: list[str] = []
        for key in next(keys for dim, _label, keys in INTERACTION_PROFILE if dim == row["id"]):
            evidence.extend(quotes.get(key, [])[:2])
        reasons.append(
            {
                "dimension": row["label"],
                "score": row["display"],
                "text": f"{behavior[0].upper() + behavior[1:]}.",
                "evidence": list(dict.fromkeys(evidence))[:2],
            }
        )
        if len(reasons) >= 4:
            break
    if not reasons:
        reasons.append(
            {
                "dimension": "Coverage",
                "score": 0,
                "text": "We did not yet see a strong pattern, so this profile stays cautious.",
                "evidence": [],
            }
        )
    return reasons


def _slot_handle(role_id: str, values: dict[str, float]) -> str:
    if role_id == "primary_assistant":
        if values.get("evidence_seeking", 0) >= 0.65:
            return "Your everyday helper for writing, planning, and decisions that need sources."
        return "Your everyday helper for planning, writing, and day-to-day questions."
    if role_id == "research":
        return "Look things up and check sources before you treat a claim as settled."
    if role_id == "coding":
        return "Build the thing: drafts, pages, files, tests, and edits."
    if role_id == "ide":
        return "Help inside your editor. Keep a short rule file there so it matches this style."
    if role_id == "automation":
        return "Turn repeating chores — invoices, emails, inventory — into a saved workflow."
    if role_id == "creative":
        return "Drafts, pictures, and posts when the work is not only text."
    if role_id == "local_private":
        return "A local or on-device option when the work should stay on your machine."
    return "Use this product for the workload named above."


def build_workstyle(user: UserFitVector, metrics: list[MetricResult] | None = None) -> dict:
    values = user.values
    profile = interaction_profile(user)
    return {
        "label": workstyle_label(values, user.confidence),
        "summary": workstyle_summary(values),
        "narrative": workstyle_narrative(values, user.confidence),
        "why": workstyle_why(user, metrics),
        "dimensions": profile,
        "maturity": maturity(user),
        "disclaimer": "This is how you like to use AI, not a personality type.",
    }


def build_operating_stack(recs: list[Recommendation], values: dict[str, float] | None = None) -> list[dict]:
    values = values or {}
    used: set[str] = set()
    slots: list[dict] = []
    for role_id, label, categories in STACK_ROLES:
        pick = None
        for category in categories:
            for rec in recs:
                if rec.category == category and rec.id not in used:
                    pick = rec
                    break
            if pick:
                break
        slots.append(
            {
                "role": role_id,
                "label": label,
                "handles": _slot_handle(role_id, values),
                "product": pick.model_dump() if pick else None,
            }
        )
        if pick:
            used.add(pick.id)
    return slots


def build_model_router(model_recs: dict[str, list[Recommendation]]) -> list[dict]:
    rows: list[dict] = []
    for route_id, label, workload in ROUTER_WORKLOADS:
        ranked = model_recs.get(workload) or []
        top = ranked[0] if ranked else None
        rows.append(
            {
                "id": route_id,
                "work": label,
                "workload": workload,
                "handles": f"Use this for {label.lower()}.",
                "model": top.model_dump() if top else None,
            }
        )
    return rows


def build_workflow(values: dict[str, float]) -> list[dict]:
    return [
        {
            "id": "research",
            "label": "Research",
            "emphasis": values.get("evidence_seeking", 0) >= 0.55,
            "instruction": "Gather sources and separate fact from guesswork before recommending.",
        },
        {
            "id": "synthesize",
            "label": "Synthesize",
            "emphasis": values.get("structure_preference", 0) >= 0.55 or values.get("comparison_preference", 0) >= 0.55,
            "instruction": "Lay the options side by side so the tradeoffs are easy to see.",
        },
        {
            "id": "challenge",
            "label": "Challenge",
            "emphasis": values.get("assumption_challenge", 0) >= 0.5,
            "instruction": "Pressure-test the leading option. Say what would change your mind.",
        },
        {
            "id": "execute",
            "label": "Execute",
            "emphasis": values.get("action_orientation", 0) >= 0.55 or values.get("code_comfort", 0) >= 0.55,
            "instruction": "Make something you can use: a draft, a plan, a file, or a saved workflow.",
        },
        {
            "id": "verify",
            "label": "Verify",
            "emphasis": values.get("evidence_seeking", 0) >= 0.6 or values.get("iteration_preference", 0) >= 0.6,
            "instruction": "Check claims or outputs against what you actually asked for.",
        },
    ]


def default_instructions(persona: dict) -> str:
    lines = [
        f"You are helping as {persona.get('label', 'a Flexible Partner')}.",
        persona.get("purpose", ""),
        "",
        "Interaction:",
        *[f"- {item}" for item in persona.get("interaction_rules", [])],
        "",
        "Responses:",
        *[f"- {item}" for item in persona.get("response_rules", [])],
        "",
        "Decisions:",
        *[f"- {item}" for item in persona.get("decision_rules", [])],
        "",
        "Tools:",
        *[f"- {item}" for item in persona.get("tool_rules", [])],
    ]
    avoid = persona.get("avoid") or []
    if avoid:
        lines += ["", "Avoid:", *[f"- {item}" for item in avoid]]
    lines += ["", persona.get("disclaimer", "")]
    return "\n".join(line for line in lines if line is not None).strip() + "\n"


def share_card_text(result: dict) -> str:
    workstyle = result.get("workstyle") or {}
    persona = result.get("persona") or {}
    dims = workstyle.get("dimensions") or []
    dim_line = " · ".join(f"{row['label']} {row.get('display', round(row.get('score', 0) * 100))}" for row in dims)
    stack = []
    for slot in result.get("operating_stack") or []:
        product = slot.get("product") or {}
        if product.get("name"):
            stack.append(product["name"])
    lines = [
        "FIT",
        workstyle.get("label") or persona.get("label") or "AI style",
        "",
        workstyle.get("narrative") or workstyle.get("summary") or "",
        "",
        dim_line,
        "",
        f"Tools: {' · '.join(stack[:5]) or 'n/a'}",
        f"How AI should talk: {persona.get('label') or 'n/a'}",
    ]
    return "\n".join(lines).strip() + "\n"


def install_guides() -> list[dict]:
    return [dict(item) for item in INSTALL_GUIDES]

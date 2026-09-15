from __future__ import annotations

import json
from pathlib import Path

from .engine import repo_root
from .models import Scenario


def load_scenarios(path: str | Path | None = None) -> list[Scenario]:
    target = Path(path) if path else repo_root() / "data/scenarios/scenarios.json"
    data = json.loads(target.read_text())
    scenarios = [Scenario.model_validate(x) for x in data]
    for scenario in scenarios:
        for turn in scenario.turns:
            for choice in turn.choices:
                for event in choice.events:
                    event.scenario_id = scenario.id
                    event.turn_id = event.turn_id or turn.id
                    if not event.evidence:
                        event.evidence = choice.label
    return scenarios


def get_scenario(scenario_id: str, path: str | Path | None = None) -> Scenario | None:
    for scenario in load_scenarios(path):
        if scenario.id == scenario_id:
            return scenario
    return None

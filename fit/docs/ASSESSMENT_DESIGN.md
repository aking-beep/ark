# Assessment Design

## Philosophy

The game should create situations that expose interaction preferences without simply asking:

"Do you like detailed answers?"

Instead, force useful tradeoffs.

## Scenario format

Each scenario should include:

- scenario_id
- title
- domain
- setup
- initial ambiguity
- available actions
- hidden information
- response rounds
- dimensions targeted
- scoring hooks

## Initial 8 scenarios

### 1. Product launch risk
Observe evidence seeking, uncertainty handling, recommendation timing.

### 2. Research a contested claim
Observe source verification, comparison behavior, breadth vs depth.

### 3. Build a small application
Observe delegation, code comfort, autonomy preference, debugging style.

### 4. Automate a recurring workflow
Observe tool appetite, explicit-control preference, integration comfort.

### 5. Create a campaign concept
Observe ideation breadth, visual preference, iteration.

### 6. Analyze messy data
Observe structure, hypothesis behavior, evidence use.

### 7. Learn an unfamiliar topic
Observe explanation preference, examples, stepwise learning, experimentation.

### 8. Executive decision
Observe tradeoffs, concise synthesis, action orientation, recommendation seeking.

## Event taxonomy

Each response should emit zero or more events:

- asked_clarification
- requested_evidence
- requested_sources
- requested_comparison
- requested_alternative
- challenged_assumption
- changed_constraint
- corrected_output
- requested_recommendation
- delegated_action
- requested_step_by_step
- requested_summary
- requested_visual
- requested_code
- requested_automation
- chose_fast_path
- chose_deep_path
- chose_local_control
- chose_cloud_service
- chose_lower_cost
- chose_best_quality

## Timing

Timing can be captured but should not materially drive v0.1 scores. Fast clicks can reflect UX or distraction rather than decision style.

## Free-text classification

v0.1:
- use keyword/rule heuristics
- preserve source text
- attach evidence references

v0.2:
- add an LLM classification adapter
- require JSON schema output
- attach model/version
- retain deterministic features
- evaluate classifier agreement

## Scenario scoring requirement

Each major behavioral dimension must be observed in at least 2 distinct scenarios before it receives "high confidence."

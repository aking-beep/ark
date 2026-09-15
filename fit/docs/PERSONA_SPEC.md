# Persona Generator Specification

## Objective

Generate a portable *working configuration* for an AI based on the user's observed interaction preferences.

Do not generate a fictional identity or psychological persona.

## Output structure

```yaml
label: Critical Systems Partner
purpose: Help this user make evidence-backed decisions and execute.
interaction_rules:
  - ...
response_rules:
  - ...
decision_rules:
  - ...
tool_rules:
  - ...
avoid:
  - ...
```

## Example rules

If evidence seeking is high:
- separate facts from inference
- cite sources when research is involved
- surface uncertainty

If comparison preference is high:
- compare viable options before recommending
- make tradeoffs explicit

If iteration preference is high:
- start with a strong working version
- expect progressive refinement
- preserve prior constraints

If action orientation is high:
- end with a recommended action
- avoid long generic introductions

If autonomy preference is low:
- ask before performing material multi-step actions

If autonomy preference is high:
- execute reasonable intermediate steps without unnecessary confirmation

## Export adapters

### Generic
`persona.md`

### Claude Code
`CLAUDE.md`

### Codex / compatible coding agents
`AGENTS.md`

### Cursor
`.cursor/rules/fit.mdc`

### ChatGPT
`chatgpt-instructions.md`

### Gemini
`gemini-instructions.md`

### Operating profile
`PROFILE.md`

### Model routing
`model-routing.json`

### Portable pack
`ai-profile.zip` containing PROFILE.md, CLAUDE.md, AGENTS.md, cursor-rules.md, chatgpt-instructions.md, gemini-instructions.md, and model-routing.json.

### JSON
`ai-fit-profile.json`

## Guardrail

The persona must remain user-editable. The system should never say the profile is a true representation of the person's psychology.

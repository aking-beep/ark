# Product Specification

## Working name

**AI Fit Engine**

Public-facing naming can change later. Keep the engine/repo name descriptive during v0.1.

## Primary user problem

People face dozens of AI products and models with overlapping marketing claims. Generic recommendation lists do not account for:

- task type
- technical ability
- preferred degree of autonomy
- evidence needs
- collaboration style
- tolerance for iteration
- need for multimodal work
- preference for speed vs depth
- desire for direct recommendations vs exploratory support
- privacy and local-control preferences
- budget sensitivity

## User promise

Complete a short interactive assessment and receive:

1. Your **AI Interaction Signature**
2. Your recommended **AI products**
3. Your recommended **models by workload**
4. Your recommended **AI stack**
5. A generated **working persona/configuration**
6. Exports for compatible tools

## Product categories

The system must be category-driven, not vendor-driven.

Initial categories:

- general_assistant
- research
- coding_agent
- ide
- automation
- knowledge
- writing
- image
- video
- presentation
- design
- data_analysis
- enterprise_search
- local_open_source

## Model workload categories

- deep_reasoning
- fast_reasoning
- coding
- long_context
- multimodal
- research
- agentic_execution
- cost_efficiency
- local_control

## Assessment dimensions

The game should observe:

### Information behavior
- evidence seeking
- clarification tendency
- source verification
- comparison preference

### Decision behavior
- recommendation timing
- alternative seeking
- tradeoff orientation
- speed vs certainty
- ambiguity tolerance

### Collaboration behavior
- delegation preference
- autonomy preference
- correction frequency
- iterative refinement
- assumption challenge frequency

### Output behavior
- structure preference
- detail preference
- action orientation
- visual/multimodal preference

### Workflow preferences
- code comfort
- automation appetite
- integration appetite
- local-control preference
- budget sensitivity

## MVP user journey

1. Landing page
2. Explain "This measures how you interact with AI, not your personality."
3. 8 scenarios
4. Each scenario contains 2-4 interaction opportunities
5. Capture choices and free text
6. Score behavioral dimensions
7. Build fit vector
8. Rank products by category
9. Rank models by workload
10. Generate persona
11. Results dashboard
12. Export configs
13. Optional save/share

## Result hierarchy

Do not overwhelm users with 30 recommendations.

Show:

- 1 primary AI stack
- 1 alternative stack
- top 1-3 tools per relevant category
- top model per major workload
- explanation
- optional advanced details

## Non-goals for v0.1

- clinical personality assessment
- employee screening
- psychometrics
- automated hiring decisions
- purchasing directly from vendors
- affiliate monetization
- opaque ranking

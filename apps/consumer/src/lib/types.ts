export type InteractionEvent = {
  event_type: string;
  scenario_id: string;
  turn_id?: string | null;
  strength?: number;
  evidence?: string | null;
};

export type Choice = {
  id: string;
  label: string;
  events: InteractionEvent[];
};

export type ScenarioTurn = {
  id: string;
  prompt: string;
  hidden_information?: string | null;
  choices: Choice[];
  allow_free_text: boolean;
};

export type Scenario = {
  id: string;
  title: string;
  domain: string;
  setup: string;
  initial_ambiguity?: string | null;
  dimensions: string[];
  turns: ScenarioTurn[];
};

export type Metric = {
  name: string;
  score: number;
  confidence: number;
  observations: number;
  scenario_ids: string[];
  evidence: string[];
};

export type Recommendation = {
  id: string;
  name: string;
  fit: number;
  confidence: number;
  positive_factors: string[];
  negative_factors: string[];
  last_evaluated_at: string;
  category?: string | null;
  base_fit?: number | null;
  freshness?: number | null;
};

export type Stack = {
  name: string;
  slots: { category: string; recommendation: Recommendation }[];
  rationale: string[];
};

export type Persona = {
  label: string;
  purpose: string;
  traits?: string[];
  interaction_rules: string[];
  response_rules: string[];
  decision_rules: string[];
  tool_rules: string[];
  avoid: string[];
  disclaimer: string;
};

export type Workstyle = {
  label: string;
  summary: string;
  narrative?: string;
  why?: { dimension: string; score: number; text: string; evidence: string[] }[];
  dimensions: { id: string; label: string; score: number; display?: number; confidence: number }[];
  maturity: { score: number; band: string; coverage: number; note: string };
  disclaimer: string;
};

export type OperatingSlot = {
  role: string;
  label: string;
  handles?: string;
  product: Recommendation | null;
};

export type ModelRoute = {
  id: string;
  work: string;
  workload: string;
  handles?: string;
  model: Recommendation | null;
};

export type WorkflowStep = {
  id: string;
  label: string;
  emphasis: boolean;
  instruction: string;
};

export type InstallGuide = {
  id: string;
  label: string;
  export_target: string;
  filename: string;
  where: string;
  steps: string[];
};

export type ScoreResult = {
  metrics: Metric[];
  user_vector: { values: Record<string, number>; confidence: Record<string, number> };
  products: Recommendation[];
  products_by_category: Record<string, Recommendation[]>;
  models: Record<string, Recommendation[]>;
  primary_stack: Stack;
  alternative_stack: Stack;
  operating_stack?: OperatingSlot[];
  model_routing?: ModelRoute[];
  workflow?: WorkflowStep[];
  workstyle?: Workstyle;
  instructions?: string;
  install_guides?: InstallGuide[];
  share_card?: string;
  persona: Persona;
  freshness?: { needs_review: { id: string; name: string; band: string }[] };
  privacy?: { mode: string; retention: string };
  disclaimer: string;
  share_id?: string;
};

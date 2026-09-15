// Presentation-only plain-language labels for the technical keys the scoring
// engine emits. This file intentionally contains NO recommendation or scoring
// logic — it only makes existing server output readable for non-technical
// people. Detailed mode can still surface the raw keys alongside these.

export function humanize(key: string): string {
  const spaced = key.replaceAll("_", " ").replaceAll("-", " ").trim();
  if (!spaced) return key;
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

// Tool/product categories (operating stack roles, product groupings).
const CATEGORY_LABELS: Record<string, string> = {
  general_assistant: "Everyday helper",
  ide: "In your code editor",
  coding_agent: "Building & coding",
  research: "Looking things up",
  knowledge: "Your documents & notes",
  automation: "Automating repeat work",
  writing: "Writing & editing",
  image: "Making images",
  design: "Design",
  presentation: "Slides & decks",
  video: "Video",
  data_analysis: "Working with data",
};

export function friendlyCategory(key: string | null | undefined): string {
  if (!key) return "Tool";
  return CATEGORY_LABELS[key] ?? humanize(key);
}

// Behavioral metrics shown in the evidence breakdown.
const METRIC_LABELS: Record<string, string> = {
  evidence_seeking: "Wanting sources",
  iteration_preference: "Tweaking & refining",
  autonomy_preference: "Letting AI run on its own",
  structure_preference: "Wanting clear structure",
  comparison_preference: "Comparing options",
  code_comfort: "Comfort with code",
  automation_appetite: "Appetite for automation",
  multimodal_preference: "Images, audio & video",
  depth_preference: "Going deep vs. quick answers",
  verification_preference: "Double-checking facts",
};

export function friendlyMetric(key: string): string {
  return METRIC_LABELS[key] ?? humanize(key);
}

const METRIC_HELP: Record<string, string> = {
  evidence_seeking: "How often you ask for sources or proof before trusting an answer.",
  iteration_preference: "Whether you like to nudge and refine, or take the first good answer.",
  autonomy_preference: "How comfortable you are letting AI take several steps on its own.",
  structure_preference: "Whether you prefer organized, structured replies.",
  comparison_preference: "Whether you like to weigh a few options before deciding.",
  code_comfort: "How much you work with code.",
  automation_appetite: "Whether you want to automate work that repeats.",
  multimodal_preference: "Whether you work with images, audio, or video, not just text.",
  depth_preference: "Whether you want depth or a fast answer.",
  verification_preference: "How much you like to double-check before acting.",
};

export function metricHelp(key: string): string | undefined {
  return METRIC_HELP[key];
}

// Model routing workloads ("what to use each model for").
const WORKLOAD_LABELS: Record<string, string> = {
  reasoning: "Hard thinking & planning",
  coding: "Writing code",
  research: "Research with sources",
  writing: "Writing & editing",
  multimodal: "Images, audio & video",
  general: "Everyday questions",
  math: "Math & analysis",
  vision: "Understanding images",
  long_context: "Very long documents",
};

export function friendlyWorkload(key: string): string {
  return WORKLOAD_LABELS[key] ?? humanize(key);
}

// Official product homepages, used only to render an "Open" link on results.
// Display-only; not part of scoring or ranking.
const PRODUCT_HOMEPAGE: Record<string, string> = {
  claude: "https://claude.ai",
  chatgpt: "https://chatgpt.com",
  gemini: "https://gemini.google.com",
  perplexity: "https://www.perplexity.ai",
  cursor: "https://www.cursor.com",
  "claude-code": "https://www.anthropic.com/claude-code",
  n8n: "https://n8n.io",
  notebooklm: "https://notebooklm.google",
  midjourney: "https://www.midjourney.com",
  runway: "https://runwayml.com",
  gamma: "https://gamma.app",
  figma: "https://www.figma.com",
  julius: "https://julius.ai",
  glean: "https://www.glean.com",
  ollama: "https://ollama.com",
  "fable-editor": "https://www.fable.la/",
};

export function productHomepage(id: string | null | undefined): string | null {
  if (!id) return null;
  return PRODUCT_HOMEPAGE[id] ?? null;
}

// Guard leftover placeholder labels if a registry row is not yet a real model.
export function cleanModelName(name: string | null | undefined): string {
  if (!name) return "Not matched yet";
  if (/placeholder/i.test(name)) {
    return name.replace(/\s*placeholder\s*$/i, "").trim() + " (example)";
  }
  return name;
}

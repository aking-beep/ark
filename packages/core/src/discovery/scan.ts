import { z } from 'zod';
import type { ModelProvider, McpTransport, ToolType } from '../agents/manifest.js';

export const RepoFile = z.object({
  path: z.string().min(1).max(500),
  content: z.string().max(64_000),
});
export type RepoFile = z.infer<typeof RepoFile>;

export const RepoSnapshot = z.object({
  repository: z.string().min(1).max(500),
  branch: z.string().min(1).max(200),
  commitSha: z.string().max(64).optional(),
  files: z.array(RepoFile).max(40),
});
export type RepoSnapshot = z.infer<typeof RepoSnapshot>;

export const DiscoveryEvidence = z.object({
  path: z.string().max(500),
  kind: z.string().max(80),
  detail: z.string().max(400),
});
export type DiscoveryEvidence = z.infer<typeof DiscoveryEvidence>;

export const DiscoveredCandidate = z.object({
  id: z.string().max(128),
  name: z.string().max(200),
  purpose: z.string().max(2_000).optional(),
  evidencePaths: z.array(z.string().max(500)).max(32),
});
export type DiscoveredCandidate = z.infer<typeof DiscoveredCandidate>;

export const DiscoveredModel = z.object({
  provider: z.string().max(40),
  modelId: z.string().max(200),
  evidencePaths: z.array(z.string().max(500)).max(16),
});
export type DiscoveredModel = z.infer<typeof DiscoveredModel>;

export const DiscoveredTool = z.object({
  name: z.string().max(200),
  type: z.string().max(40),
  evidencePaths: z.array(z.string().max(500)).max(16),
});
export type DiscoveredTool = z.infer<typeof DiscoveredTool>;

export const DiscoveredMcp = z.object({
  name: z.string().max(200),
  transport: z.string().max(40),
  source: z.string().max(500).optional(),
  tools: z.array(z.string().max(120)).max(32).optional(),
  evidencePaths: z.array(z.string().max(500)).max(16),
});
export type DiscoveredMcp = z.infer<typeof DiscoveredMcp>;

export const DiscoveredIntegration = z.object({
  name: z.string().max(200),
  type: z.string().max(40),
  evidencePaths: z.array(z.string().max(500)).max(16),
});
export type DiscoveredIntegration = z.infer<typeof DiscoveredIntegration>;

export const DiscoveredInfra = z.object({
  kind: z.string().max(80),
  name: z.string().max(200),
  evidencePaths: z.array(z.string().max(500)).max(16),
});
export type DiscoveredInfra = z.infer<typeof DiscoveredInfra>;

export const DiscoveryResult = z.object({
  repository: z.string(),
  branch: z.string(),
  commitSha: z.string().optional(),
  candidates: z.array(DiscoveredCandidate).max(32),
  models: z.array(DiscoveredModel).max(32),
  tools: z.array(DiscoveredTool).max(64),
  mcpServers: z.array(DiscoveredMcp).max(32),
  integrations: z.array(DiscoveredIntegration).max(32),
  infrastructure: z.array(DiscoveredInfra).max(32),
  frameworks: z.array(z.string().max(80)).max(32),
  envVarRefs: z.array(z.string().max(120)).max(64),
  evidence: z.array(DiscoveryEvidence).max(200),
  warnings: z.array(z.string().max(400)).max(40),
  confidence: z.number().min(0).max(1),
});
export type DiscoveryResult = z.infer<typeof DiscoveryResult>;

const SECRET_ASSIGN = /^\s*(?:export\s+)?([A-Z][A-Z0-9_]{2,})\s*=\s*(.+)$/;
const ENV_NAME = /\b([A-Z][A-Z0-9_]{3,}(?:API_KEY|TOKEN|SECRET|PASSWORD|_KEY))\b/g;
const LOOKS_SECRET = /^(sk-|rk-|ghp_|github_pat_|xox[baprs]-|AKIA)[A-Za-z0-9/_+=.-]{8,}$/;

const PROVIDERS: { re: RegExp; provider: ModelProvider; pkg?: string }[] = [
  { re: /\bopenai\b/i, provider: 'openai', pkg: 'openai' },
  { re: /\banthropic\b/i, provider: 'anthropic', pkg: '@anthropic-ai/sdk' },
  { re: /\b@google\/generative-ai\b|\bgoogle-generativeai\b|\bgemini\b/i, provider: 'google' },
  { re: /\bbedrock\b|\b@aws-sdk\/client-bedrock/i, provider: 'bedrock' },
  { re: /\bollama\b/i, provider: 'ollama' },
];

const FRAMEWORKS: { re: RegExp; name: string; pkg?: string }[] = [
  { re: /\blanggraph\b/i, name: 'langgraph', pkg: '@langchain/langgraph' },
  { re: /\blangchain\b/i, name: 'langchain', pkg: 'langchain' },
  { re: /\bcrewai\b/i, name: 'crewai' },
  { re: /\bautogen\b|\bag2\b/i, name: 'autogen' },
  { re: /\b@modelcontextprotocol\/sdk\b|\bmcp\b/i, name: 'mcp' },
  { re: /\ba2a\b|agent-to-agent/i, name: 'a2a' },
];

const MODEL_ID = /\b(gpt-4o(?:-mini)?|gpt-4\.1(?:-mini)?|claude-(?:3(?:\.[5-7])?|haiku|sonnet|opus)[a-z0-9.-]*|gemini-(?:1\.5|2\.0|pro|flash)[a-z0-9.-]*|llama[\w.-]+|mistral-[\w.-]+)\b/gi;

function addEvidence(
  evidence: DiscoveryEvidence[],
  byKey: Map<string, string[]>,
  key: string,
  path: string,
  kind: string,
  detail: string,
) {
  evidence.push({ path, kind, detail: detail.slice(0, 400) });
  const list = byKey.get(key) ?? [];
  if (!list.includes(path)) list.push(path);
  byKey.set(key, list);
}

export function discoverRepository(raw: unknown): DiscoveryResult {
  const snap = RepoSnapshot.parse(raw);
  const evidence: DiscoveryEvidence[] = [];
  const warnings: string[] = [];
  const envVarRefs = new Set<string>();
  const frameworks = new Set<string>();
  const modelMap = new Map<string, { provider: string; modelId: string; paths: string[] }>();
  const toolMap = new Map<string, { name: string; type: string; paths: string[] }>();
  const mcpMap = new Map<string, DiscoveredMcp>();
  const integMap = new Map<string, DiscoveredIntegration>();
  const infra: DiscoveredInfra[] = [];
  const candidates: DiscoveredCandidate[] = [];
  const pathIndex = new Map<string, string[]>();

  for (const file of snap.files) {
    const p = file.path;
    const c = file.content;
    scanSecrets(c, p, envVarRefs, warnings);
    scanPackageJson(file, frameworks, modelMap, evidence, pathIndex);
    scanPyDeps(file, frameworks, evidence, pathIndex);
    scanMcpConfig(file, mcpMap, evidence);
    scanModels(c, p, modelMap, evidence, pathIndex);
    scanTools(c, p, toolMap, evidence);
    scanFrameworks(c, p, frameworks, evidence, pathIndex);
    scanAgents(c, p, candidates, evidence);
    scanInfra(file, infra, evidence);
    scanEvalPolicy(file, infra, evidence);
    scanIntegrations(c, p, integMap, evidence);
  }

  if (candidates.length === 0 && (frameworks.size > 0 || modelMap.size > 0 || mcpMap.size > 0)) {
    const slug = slugFromRepo(snap.repository);
    candidates.push({
      id: slug,
      name: slug.replace(/-/g, ' '),
      evidencePaths: [...new Set(evidence.map((e) => e.path))].slice(0, 16),
    });
  }

  const confidence = scoreConfidence({
    candidates: candidates.length,
    models: modelMap.size,
    tools: toolMap.size,
    mcp: mcpMap.size,
    frameworks: frameworks.size,
    evidence: evidence.length,
  });

  return DiscoveryResult.parse({
    repository: snap.repository,
    branch: snap.branch,
    commitSha: snap.commitSha,
    candidates,
    models: [...modelMap.values()].map((m) => ({
      provider: m.provider,
      modelId: m.modelId,
      evidencePaths: m.paths.slice(0, 16),
    })),
    tools: [...toolMap.values()].map((t) => ({
      name: t.name,
      type: t.type,
      evidencePaths: t.paths.slice(0, 16),
    })),
    mcpServers: [...mcpMap.values()],
    integrations: [...integMap.values()],
    infrastructure: infra.slice(0, 32),
    frameworks: [...frameworks].slice(0, 32),
    envVarRefs: [...envVarRefs].slice(0, 64),
    evidence: evidence.slice(0, 200),
    warnings: warnings.slice(0, 40),
    confidence,
  });
}

function slugFromRepo(url: string): string {
  const last = url.split('/').filter(Boolean).pop() ?? 'agent';
  return last.replace(/\.git$/, '').slice(0, 80) || 'discovered-agent';
}

function scoreConfidence(n: {
  candidates: number;
  models: number;
  tools: number;
  mcp: number;
  frameworks: number;
  evidence: number;
}): number {
  const bits = [n.candidates, n.models, n.tools, n.mcp, n.frameworks].filter((x) => x > 0).length;
  if (n.evidence === 0) return 0;
  return Math.min(1, 0.15 * bits + Math.min(0.4, n.evidence / 40));
}

function scanSecrets(content: string, path: string, refs: Set<string>, warnings: string[]) {
  for (const line of content.split('\n')) {
    const m = SECRET_ASSIGN.exec(line);
    if (m) {
      const name = m[1]!;
      const value = m[2]!.trim().replace(/^['"]|['"]$/g, '');
      if (LOOKS_SECRET.test(value) || /key|token|secret|password/i.test(name)) {
        refs.add(name);
        if (LOOKS_SECRET.test(value)) {
          warnings.push(`Possible secret assignment in ${path} (${name}); value not stored.`);
        }
      }
    }
  }
  ENV_NAME.lastIndex = 0;
  let em: RegExpExecArray | null;
  while ((em = ENV_NAME.exec(content))) refs.add(em[1]!);
}

function scanPackageJson(
  file: RepoFile,
  frameworks: Set<string>,
  models: Map<string, { provider: string; modelId: string; paths: string[] }>,
  evidence: DiscoveryEvidence[],
  pathIndex: Map<string, string[]>,
) {
  if (!file.path.endsWith('package.json')) return;
  let json: { dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
  try {
    json = JSON.parse(file.content);
  } catch {
    return;
  }
  const deps = { ...json.dependencies, ...json.devDependencies };
  for (const [pkg] of Object.entries(deps)) {
    for (const f of FRAMEWORKS) {
      if (f.pkg && pkg === f.pkg) {
        frameworks.add(f.name);
        addEvidence(evidence, pathIndex, f.name, file.path, 'framework', `dependency ${pkg}`);
      }
    }
    for (const p of PROVIDERS) {
      if (p.pkg && pkg === p.pkg) {
        const key = `${p.provider}:unknown`;
        if (!models.has(key)) models.set(key, { provider: p.provider, modelId: 'unknown', paths: [file.path] });
        addEvidence(evidence, pathIndex, key, file.path, 'provider', `dependency ${pkg}`);
      }
    }
    if (pkg === '@modelcontextprotocol/sdk') {
      frameworks.add('mcp');
      addEvidence(evidence, pathIndex, 'mcp', file.path, 'mcp', `dependency ${pkg}`);
    }
    if (pkg === '@ark/runtime' || pkg === '@ark/sdk') {
      addEvidence(evidence, pathIndex, pkg, file.path, 'runtime', `dependency ${pkg}`);
    }
  }
}

function scanPyDeps(
  file: RepoFile,
  frameworks: Set<string>,
  evidence: DiscoveryEvidence[],
  pathIndex: Map<string, string[]>,
) {
  const base = file.path.split('/').pop() ?? '';
  if (base !== 'requirements.txt' && base !== 'pyproject.toml') return;
  const text = file.content.toLowerCase();
  for (const f of FRAMEWORKS) {
    if (text.includes(f.name)) {
      frameworks.add(f.name);
      addEvidence(evidence, pathIndex, f.name, file.path, 'framework', f.name);
    }
  }
}

function scanMcpConfig(file: RepoFile, mcpMap: Map<string, DiscoveredMcp>, evidence: DiscoveryEvidence[]) {
  const base = file.path.split('/').pop()?.toLowerCase() ?? '';
  if (!base.includes('mcp') || (!base.endsWith('.json') && !file.content.includes('"mcpServers"'))) return;
  let json: { mcpServers?: Record<string, { command?: string; url?: string; args?: string[] }> };
  try {
    json = JSON.parse(file.content);
  } catch {
    return;
  }
  const servers = json.mcpServers ?? {};
  for (const [name, cfg] of Object.entries(servers)) {
    const transport: McpTransport = cfg.command ? 'stdio' : cfg.url ? 'streamable-http' : 'unknown';
    mcpMap.set(name, {
      name,
      transport,
      source: safeMcpSource(cfg.command ?? cfg.url),
      evidencePaths: [file.path],
    });
    evidence.push({ path: file.path, kind: 'mcp', detail: `server ${name}` });
  }
}

function scanModels(
  content: string,
  path: string,
  models: Map<string, { provider: string; modelId: string; paths: string[] }>,
  evidence: DiscoveryEvidence[],
  pathIndex: Map<string, string[]>,
) {
  const importHit = /from ['"]openai['"]|require\(['"]openai['"]\)|from openai import|ChatAnthropic|BedrockRuntime|ChatGoogleGenerativeAI|new OpenAI|Anthropic\(/.test(
    content,
  );
  MODEL_ID.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = MODEL_ID.exec(content))) {
    const modelId = m[1]!;
    const provider = providerOf(modelId);
    if (!importHit && !/\bmodel\s*[:=]/i.test(content.slice(Math.max(0, m.index - 40), m.index + 40))) {
      continue;
    }
    const key = `${provider}:${modelId}`;
    const row = models.get(key) ?? { provider, modelId, paths: [] };
    if (!row.paths.includes(path)) row.paths.push(path);
    models.set(key, row);
    addEvidence(evidence, pathIndex, key, path, 'model', modelId);
  }
}

function providerOf(modelId: string): string {
  if (modelId.startsWith('gpt')) return 'openai';
  if (modelId.startsWith('claude')) return 'anthropic';
  if (modelId.startsWith('gemini')) return 'google';
  if (modelId.startsWith('llama')) return 'ollama';
  return 'unknown';
}

function scanTools(
  content: string,
  path: string,
  tools: Map<string, { name: string; type: string; paths: string[] }>,
  evidence: DiscoveryEvidence[],
) {
  const fnTool = /(?:tools\.create|tool\(\s*['"]([A-Za-z0-9_-]+)|name:\s*['"]([A-Za-z0-9_-]+)['"][^\n]{0,80}(?:function|tool))/gi;
  let m: RegExpExecArray | null;
  while ((m = fnTool.exec(content))) {
    const name = m[1] || m[2];
    if (!name) continue;
    const type: ToolType = content.includes('mcp') ? 'mcp' : 'function';
    const row = tools.get(name) ?? { name, type, paths: [] };
    if (!row.paths.includes(path)) row.paths.push(path);
    tools.set(name, row);
    evidence.push({ path, kind: 'tool', detail: name });
  }
}

function scanFrameworks(
  content: string,
  path: string,
  frameworks: Set<string>,
  evidence: DiscoveryEvidence[],
  pathIndex: Map<string, string[]>,
) {
  if (!/import |from |require\(/.test(content) && !path.endsWith('.toml')) return;
  for (const f of FRAMEWORKS) {
    if (f.re.test(content) && /import |from |require\(/.test(content)) {
      frameworks.add(f.name);
      addEvidence(evidence, pathIndex, f.name, path, 'framework', f.name);
    }
  }
}

function scanAgents(content: string, path: string, candidates: DiscoveredCandidate[], evidence: DiscoveryEvidence[]) {
  const agentRe =
    /(?:createReactAgent|create_agent|Agent(?:Runtime|Executor)?|ChatAgent)\s*\(|name:\s*['"]([A-Za-z0-9_-]*agent[A-Za-z0-9_-]*)['"]/gi;
  let m: RegExpExecArray | null;
  const paths = new Set<string>();
  while ((m = agentRe.exec(content))) {
    const named = m[1];
    const id = (named ?? basenameAgent(path)).slice(0, 128);
    if (candidates.some((c) => c.id === id)) continue;
    candidates.push({
      id,
      name: id.replace(/-/g, ' '),
      evidencePaths: [path],
    });
    paths.add(path);
    evidence.push({ path, kind: 'agent', detail: id });
  }
  const base = path.split('/').pop()?.toLowerCase() ?? '';
  if ((base === 'agents.md' || base === 'claude.md') && candidates.length === 0) {
    candidates.push({
      id: 'repo-agent',
      name: 'Repository agent',
      purpose: firstLine(content),
      evidencePaths: [path],
    });
    evidence.push({ path, kind: 'agent', detail: base });
  }
}

function basenameAgent(path: string): string {
  const b = path.split('/').pop() ?? 'agent';
  return b.replace(/\.[^.]+$/, '').slice(0, 80);
}

function firstLine(content: string): string | undefined {
  const line = content.split('\n').find((l) => l.trim() && !l.startsWith('#'));
  return line?.trim().slice(0, 400);
}

function scanInfra(file: RepoFile, infra: DiscoveredInfra[], evidence: DiscoveryEvidence[]) {
  const base = file.path.split('/').pop()?.toLowerCase() ?? '';
  if (base === 'dockerfile') {
    infra.push({ kind: 'container', name: 'Dockerfile', evidencePaths: [file.path] });
    evidence.push({ path: file.path, kind: 'infra', detail: 'Dockerfile' });
  }
  if (base.startsWith('docker-compose') || base === 'compose.yml' || base === 'compose.yaml') {
    infra.push({ kind: 'compose', name: base, evidencePaths: [file.path] });
    evidence.push({ path: file.path, kind: 'infra', detail: 'compose' });
  }
}

function scanEvalPolicy(file: RepoFile, infra: DiscoveredInfra[], evidence: DiscoveryEvidence[]) {
  const base = file.path.split('/').pop()?.toLowerCase() ?? '';
  if (/\beval|\bgolden/.test(base) || base === 'pytest.ini' || base.startsWith('vitest.config')) {
    infra.push({ kind: 'evaluation', name: base, evidencePaths: [file.path] });
    evidence.push({ path: file.path, kind: 'evaluation', detail: base });
  }
  if (/\bpolicy\b/.test(base) || base === 'opa' || base.endsWith('.rego')) {
    infra.push({ kind: 'policy', name: base, evidencePaths: [file.path] });
    evidence.push({ path: file.path, kind: 'policy', detail: base });
  }
}

function safeMcpSource(value?: string): string | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  if (LOOKS_SECRET.test(trimmed) || /token=|api[_-]?key|password/i.test(trimmed)) return undefined;
  return trimmed.slice(0, 500);
}

function scanIntegrations(
  content: string,
  path: string,
  integ: Map<string, DiscoveredIntegration>,
  evidence: DiscoveryEvidence[],
) {
  const hits: { re: RegExp; name: string; type: string }[] = [
    { re: /\bstripe\b/i, name: 'stripe', type: 'saas' },
    { re: /\bsalesforce\b/i, name: 'salesforce', type: 'saas' },
    { re: /\bpostgres(?:ql)?\b|\bsqlite\b/i, name: 'sql', type: 'database' },
    { re: /\bredis\b/i, name: 'redis', type: 'queue' },
    { re: /\bhttps?:\/\/[a-z0-9.-]+\/api\b/i, name: 'http-api', type: 'http' },
  ];
  if (!/import |from |require\(/.test(content) && !path.endsWith('docker-compose.yml')) return;
  for (const h of hits) {
    if (h.re.test(content)) {
      if (!integ.has(h.name)) {
        integ.set(h.name, { name: h.name, type: h.type, evidencePaths: [path] });
        evidence.push({ path, kind: 'integration', detail: h.name });
      }
    }
  }
}

import { AgentManifest, type AgentManifest as Manifest, type DiscoveryMethod } from '../agents/manifest.js';
import type { DiscoveryResult } from './scan.js';

export type FieldBasis = 'observed' | 'inferred' | 'unknown';

export interface ManifestCandidate {
  manifest: Manifest;
  fields: Record<string, FieldBasis>;
}

function basisMap(): Record<string, FieldBasis> {
  return {
    id: 'unknown',
    name: 'unknown',
    purpose: 'unknown',
    owner: 'unknown',
    team: 'unknown',
    status: 'inferred',
    environment: 'unknown',
    riskLevel: 'unknown',
    source: 'observed',
    models: 'unknown',
    tools: 'unknown',
    mcpServers: 'unknown',
    integrations: 'unknown',
    dataAccess: 'unknown',
    permissions: 'unknown',
    governance: 'unknown',
  };
}

/**
 * Turn discovery into Agent Manifest candidates.
 * Observed = present in evidence. Inferred = derived (status=discovered).
 * Unknown = not filled. Never invents owner, policies, permissions, or data classes.
 */
export function materializeAgentManifests(
  discovery: DiscoveryResult,
  opts: { discoveryMethod?: DiscoveryMethod } = {},
): ManifestCandidate[] {
  if (discovery.candidates.length === 0) return [];
  const method = opts.discoveryMethod ?? 'snapshot';

  return discovery.candidates.map((c) => {
    const fields = basisMap();
    fields.id = 'observed';
    fields.name = 'observed';
    if (c.purpose) fields.purpose = 'observed';
    fields.status = 'inferred';
    if (discovery.models.length) fields.models = 'observed';
    if (discovery.tools.length) fields.tools = 'observed';
    if (discovery.mcpServers.length) fields.mcpServers = 'observed';
    if (discovery.integrations.length) fields.integrations = 'observed';

    const manifest = AgentManifest.parse({
      id: c.id,
      name: c.name,
      purpose: c.purpose,
      status: 'discovered',
      environment: 'unknown',
      riskLevel: 'unknown',
      source: {
        repository: discovery.repository,
        branch: discovery.branch,
        commitSha: discovery.commitSha,
        discoveredAt: Date.now(),
        discoveryMethod: method,
      },
      models: discovery.models.map((m) => ({
        provider: knownProvider(m.provider),
        modelId: m.modelId,
      })),
      tools: discovery.tools.map((t) => ({
        name: t.name,
        type: knownTool(t.type),
      })),
      mcpServers: discovery.mcpServers.map((s) => ({
        name: s.name,
        transport: knownTransport(s.transport),
        source: s.source,
        tools: s.tools,
      })),
      integrations: discovery.integrations.map((i) => ({
        name: i.name,
        type: knownInteg(i.type),
      })),
      discovery: {
        confidence: discovery.confidence,
        evidencePaths: [...new Set([...c.evidencePaths, ...discovery.evidence.map((e) => e.path)])].slice(0, 64),
      },
    });

    return { manifest, fields };
  });
}

function knownProvider(p: string): Manifest['models'][number]['provider'] {
  const set = new Set(['openai', 'anthropic', 'google', 'bedrock', 'ollama', 'azure', 'mistral', 'unknown']);
  return (set.has(p) ? p : 'unknown') as Manifest['models'][number]['provider'];
}

function knownTool(t: string): Manifest['tools'][number]['type'] {
  const set = new Set(['function', 'mcp', 'http', 'shell', 'browser', 'unknown']);
  return (set.has(t) ? t : 'unknown') as Manifest['tools'][number]['type'];
}

function knownTransport(t: string): NonNullable<Manifest['mcpServers']>[number]['transport'] {
  const set = new Set(['stdio', 'sse', 'streamable-http', 'unknown']);
  return (set.has(t) ? t : 'unknown') as NonNullable<Manifest['mcpServers']>[number]['transport'];
}

function knownInteg(t: string): NonNullable<Manifest['integrations']>[number]['type'] {
  const set = new Set(['http', 'sdk', 'database', 'queue', 'saas', 'unknown']);
  return (set.has(t) ? t : 'unknown') as NonNullable<Manifest['integrations']>[number]['type'];
}

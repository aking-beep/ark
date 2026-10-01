import { z } from 'zod';

/** Bounded strings so a manifest cannot become a payload dump. */
const id = z.string().min(1).max(128);
const name = z.string().min(1).max(200);
const short = z.string().max(2_000);
const pathStr = z.string().max(500);

export const AgentStatus = z.enum(['unknown', 'discovered', 'registered', 'shadow', 'production', 'retired']);
export type AgentStatus = z.infer<typeof AgentStatus>;

export const AgentEnvironment = z.enum(['unknown', 'development', 'staging', 'production']);
export type AgentEnvironment = z.infer<typeof AgentEnvironment>;

export const AgentRiskLevel = z.enum(['unknown', 'low', 'medium', 'high', 'critical']);
export type AgentRiskLevel = z.infer<typeof AgentRiskLevel>;

export const DiscoveryMethod = z.enum(['github', 'snapshot', 'manual', 'runtime']);
export type DiscoveryMethod = z.infer<typeof DiscoveryMethod>;

export const ModelProvider = z.enum([
  'openai',
  'anthropic',
  'google',
  'bedrock',
  'ollama',
  'azure',
  'mistral',
  'unknown',
]);
export type ModelProvider = z.infer<typeof ModelProvider>;

export const ToolType = z.enum(['function', 'mcp', 'http', 'shell', 'browser', 'unknown']);
export type ToolType = z.infer<typeof ToolType>;

export const McpTransport = z.enum(['stdio', 'sse', 'streamable-http', 'unknown']);
export type McpTransport = z.infer<typeof McpTransport>;

export const IntegrationType = z.enum(['http', 'sdk', 'database', 'queue', 'saas', 'unknown']);
export type IntegrationType = z.infer<typeof IntegrationType>;

export const IntegrationDirection = z.enum(['inbound', 'outbound', 'both', 'unknown']);
export type IntegrationDirection = z.infer<typeof IntegrationDirection>;

export const DataClassName = z.enum([
  'public',
  'internal',
  'pii',
  'sensitive_pii',
  'phi',
  'pci',
  'financial',
  'credentials',
  'trade_secret',
  'minors',
  'unknown',
]);
export type DataClassName = z.infer<typeof DataClassName>;

export const AgentSource = z.object({
  repository: z.string().max(500).optional(),
  commitSha: z.string().max(64).optional(),
  branch: z.string().max(200).optional(),
  discoveredAt: z.number().int().optional(),
  discoveryMethod: DiscoveryMethod.optional(),
});
export type AgentSource = z.infer<typeof AgentSource>;

export const AgentModel = z.object({
  provider: ModelProvider,
  modelId: z.string().max(200),
  purpose: short.optional(),
});
export type AgentModel = z.infer<typeof AgentModel>;

export const AgentTool = z.object({
  name: name,
  type: ToolType,
  description: short.optional(),
  riskLevel: AgentRiskLevel.default('unknown'),
  permissions: z.array(z.string().max(80)).max(32).optional(),
});
export type AgentTool = z.infer<typeof AgentTool>;

export const AgentMcpServer = z.object({
  name: name,
  transport: McpTransport.default('unknown'),
  source: z.string().max(500).optional(),
  tools: z.array(z.string().max(120)).max(64).optional(),
});
export type AgentMcpServer = z.infer<typeof AgentMcpServer>;

export const AgentIntegration = z.object({
  name: name,
  type: IntegrationType.default('unknown'),
  system: z.string().max(200).optional(),
  direction: IntegrationDirection.default('unknown'),
});
export type AgentIntegration = z.infer<typeof AgentIntegration>;

export const AgentDataAccess = z.object({
  dataClasses: z.array(DataClassName).max(16).default([]),
  containsPII: z.boolean().optional(),
  containsFinancial: z.boolean().optional(),
  containsHealth: z.boolean().optional(),
  externalData: z.boolean().optional(),
});
export type AgentDataAccess = z.infer<typeof AgentDataAccess>;

export const AgentPermissions = z.object({
  read: z.boolean().optional(),
  write: z.boolean().optional(),
  execute: z.boolean().optional(),
  financial: z.boolean().optional(),
  destructive: z.boolean().optional(),
  wildcard: z.boolean().optional(),
});
export type AgentPermissions = z.infer<typeof AgentPermissions>;

export const AgentGovernance = z.object({
  policyRefs: z.array(z.string().max(200)).max(32).default([]),
  evaluationRefs: z.array(z.string().max(200)).max(32).default([]),
  approvalRequired: z.boolean().optional(),
  humanEscalation: z.boolean().optional(),
});
export type AgentGovernance = z.infer<typeof AgentGovernance>;

export const AgentDiscoveryMeta = z.object({
  confidence: z.number().min(0).max(1).optional(),
  evidencePaths: z.array(pathStr).max(64).default([]),
});
export type AgentDiscoveryMeta = z.infer<typeof AgentDiscoveryMeta>;

export const AgentManifest = z.object({
  id,
  name,
  purpose: short.optional(),
  description: short.optional(),
  owner: z.string().max(200).optional(),
  team: z.string().max(200).optional(),
  status: AgentStatus.default('unknown'),
  environment: AgentEnvironment.default('unknown'),
  riskLevel: AgentRiskLevel.default('unknown'),
  source: AgentSource.optional(),
  models: z.array(AgentModel).max(32).default([]),
  tools: z.array(AgentTool).max(64).default([]),
  mcpServers: z.array(AgentMcpServer).max(32).default([]),
  integrations: z.array(AgentIntegration).max(32).default([]),
  dataAccess: AgentDataAccess.optional(),
  permissions: AgentPermissions.optional(),
  governance: AgentGovernance.optional(),
  discovery: AgentDiscoveryMeta.optional(),
});
export type AgentManifest = z.infer<typeof AgentManifest>;

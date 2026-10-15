import type { RepoSnapshot } from './scan.js';

/**
 * A bundled repository snapshot, so Discover → Register → Assure can be walked
 * on any org with no network: GitHub is often unreachable from a demo, a CI
 * runner or an air-gapped install, and a walk that dead-ends at the first step
 * teaches nothing.
 *
 * It is input, not output. The seed and the "Try the sample repository" action
 * both run it through the real `discoverRepository`, so what the page shows is
 * what the scanner finds — nothing here is a hand-written discovery result.
 *
 * It describes the support desk the Demo Co telemetry comes from: a triage
 * agent and a refund specialist over a CRM MCP server. The procurement agent
 * that also appears in that telemetry is deliberately absent — it is the agent
 * running in production that nobody checked in, which is the case Discover
 * exists to surface.
 */
export const SAMPLE_REPOSITORY_NAME = 'ark-sample://support-desk';

const FILES: RepoSnapshot['files'] = [
  {
    path: 'README.md',
    content: [
      '# support-desk',
      '',
      'Bundled ARK sample repository. Not a real codebase: a fixed snapshot used to demonstrate discovery.',
      'Inbound tickets are triaged by one agent; refunds are delegated to a second one over A2A.',
      '',
    ].join('\n'),
  },
  {
    path: 'package.json',
    content: JSON.stringify(
      {
        name: 'support-desk',
        private: true,
        dependencies: {
          '@anthropic-ai/sdk': '^0.30.0',
          '@langchain/langgraph': '^0.2.0',
          '@modelcontextprotocol/sdk': '^1.0.0',
          '@a2a-js/sdk': '^0.2.0',
          '@ark/sdk': '^0.1.0',
          jsforce: '^3.0.0',
        },
      },
      null,
      2,
    ),
  },
  {
    path: 'src/agents/support-agent.ts',
    content: [
      "import Anthropic from '@anthropic-ai/sdk';",
      "import { createReactAgent } from '@langchain/langgraph/prebuilt';",
      "import { tool } from '@langchain/core/tools';",
      "import { A2AClient } from '@a2a-js/sdk';",
      '',
      '// Classify the ticket, read the customer from the CRM, hand refunds to the refund specialist.',
      "const model = 'claude-sonnet-5';",
      "const escalationModel = 'claude-opus-5';",
      '',
      "const searchCustomer = tool('search_customer', { description: 'CRM lookup via crm-mcp' });",
      "const routeTicket = tool('route_ticket', { description: 'Tag and route in Zendesk' });",
      '',
      'export const supportAgent = createReactAgent({',
      "  name: 'support-agent',",
      '  llm: new Anthropic(),',
      '  model,',
      '  fallbackModel: escalationModel,',
      '  tools: [searchCustomer, routeTicket],',
      '});',
      '',
    ].join('\n'),
  },
  {
    path: 'src/agents/refund-agent.ts',
    content: [
      "import Anthropic from '@anthropic-ai/sdk';",
      "import { createReactAgent } from '@langchain/langgraph/prebuilt';",
      "import { tool } from '@langchain/core/tools';",
      "import { Connection } from 'jsforce'; // Salesforce",
      '',
      '// Issues refunds in Salesforce. Above the ceiling, a person approves on the support console.',
      "const model = 'claude-sonnet-5';",
      '',
      "const issueRefund = tool('issue_refund', { description: 'Credit the order in Salesforce' });",
      '',
      'export const refundAgent = createReactAgent({',
      "  name: 'refund-agent',",
      '  llm: new Anthropic(),',
      '  model,',
      '  tools: [issueRefund],',
      '});',
      '',
    ].join('\n'),
  },
  {
    path: '.mcp.json',
    content: JSON.stringify(
      { mcpServers: { 'crm-mcp': { url: 'https://crm.internal.example/mcp' } } },
      null,
      2,
    ),
  },
  {
    path: '.env.example',
    content: 'ANTHROPIC_API_KEY=replace-me\nSALESFORCE_TOKEN=replace-me\nARK_INGEST_TOKEN=replace-me\n',
  },
  {
    path: 'evals/refund-golden.jsonl',
    content: '{"case":"refund-under-ceiling","expect":"approve"}\n{"case":"refund-over-ceiling","expect":"escalate"}\n',
  },
  { path: 'policies/refund-policy.rego', content: 'package refunds\n\ndefault allow := false\n' },
  { path: 'Dockerfile', content: 'FROM node:22-slim\nWORKDIR /app\nCOPY . .\nCMD ["node", "dist/index.js"]\n' },
];

/** A fresh copy each call, so a caller that edits the snapshot cannot change the next one. */
export function sampleRepositorySnapshot(): RepoSnapshot {
  return {
    repository: SAMPLE_REPOSITORY_NAME,
    branch: 'main',
    files: FILES.map((f) => ({ ...f })),
  };
}

/** True for a discovery run over the bundled sample rather than a fetched repository. */
export function isSampleRepository(repository: string): boolean {
  return repository === SAMPLE_REPOSITORY_NAME;
}

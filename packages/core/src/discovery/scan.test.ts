import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { discoverRepository } from './scan.js';

describe('discoverRepository', () => {
  test('finds LangGraph, OpenAI, tools and MCP with evidence paths', () => {
    const result = discoverRepository({
      repository: 'https://github.com/acme/support-bot',
      branch: 'main',
      commitSha: 'deadbeef',
      files: [
        {
          path: 'package.json',
          content: JSON.stringify({
            dependencies: {
              openai: '^4.0.0',
              '@langchain/langgraph': '^0.2.0',
              '@modelcontextprotocol/sdk': '^1.0.0',
            },
          }),
        },
        {
          path: 'src/agent.ts',
          content: `
            import { ChatOpenAI } from '@langchain/openai';
            import { createReactAgent } from '@langchain/langgraph/prebuilt';
            const model = 'gpt-4o';
            const agent = createReactAgent({ name: 'support-agent' });
            tools.create({ name: 'lookup_ticket', type: 'function' });
          `,
        },
        {
          path: '.mcp.json',
          content: JSON.stringify({
            mcpServers: { github: { command: 'npx', args: ['-y', '@modelcontextprotocol/server-github'] } },
          }),
        },
      ],
    });
    assert.ok(result.frameworks.includes('langgraph'));
    assert.ok(result.frameworks.includes('mcp'));
    assert.ok(result.models.some((m) => m.modelId === 'gpt-4o' && m.provider === 'openai'));
    assert.ok(result.mcpServers.some((s) => s.name === 'github' && s.transport === 'stdio'));
    assert.ok(result.candidates.length >= 1);
    assert.ok(result.evidence.every((e) => e.path.length > 0));
    assert.ok(result.confidence > 0);
    assert.ok(result.tools.length >= 1);
  });

  test('does not invent agents from a README that mentions the word agent', () => {
    const result = discoverRepository({
      repository: 'https://github.com/acme/docs',
      branch: 'main',
      files: [
        { path: 'README.md', content: 'This repository is not an agent. We used to have a travel agent form.' },
        { path: 'index.js', content: 'console.log("hello");\n' },
      ],
    });
    assert.equal(result.candidates.length, 0);
    assert.equal(result.models.length, 0);
    assert.equal(result.mcpServers.length, 0);
    assert.equal(result.frameworks.length, 0);
    assert.ok(result.confidence < 0.3);
  });

  test('records secret-looking assignments as env names, never values', () => {
    const result = discoverRepository({
      repository: 'https://github.com/acme/bot',
      branch: 'main',
      files: [
        {
          path: '.env.example',
          content: 'OPENAI_API_KEY=sk-abcdefghijklmnopqrstuvwxyz123456\nAPP_TOKEN=not-a-secret\n',
        },
        {
          path: 'src/client.ts',
          content: "import OpenAI from 'openai';\nconst client = new OpenAI();\nconst model = 'gpt-4o-mini';\n",
        },
      ],
    });
    assert.ok(result.envVarRefs.includes('OPENAI_API_KEY'));
    assert.equal(JSON.stringify(result).includes('sk-abcdefghijklmnopqrstuvwxyz123456'), false);
    assert.ok(result.warnings.some((w) => w.includes('OPENAI_API_KEY') && w.includes('value not stored')));
  });

  test('rejects oversized snapshots at the schema boundary', () => {
    assert.throws(() =>
      discoverRepository({
        repository: 'https://github.com/acme/bot',
        branch: 'main',
        files: Array.from({ length: 41 }, (_, i) => ({ path: `f${i}.ts`, content: 'x' })),
      }),
    );
  });
});

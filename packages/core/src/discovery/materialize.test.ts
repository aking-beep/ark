import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { discoverRepository } from './scan.js';
import { materializeAgentManifests } from './materialize.js';

describe('materializeAgentManifests', () => {
  test('marks observed inventory and leaves owner, policy, permissions and data unknown', () => {
    const discovery = discoverRepository({
      repository: 'https://github.com/acme/support-bot',
      branch: 'main',
      commitSha: 'abc',
      files: [
        {
          path: 'package.json',
          content: JSON.stringify({ dependencies: { openai: '4', '@modelcontextprotocol/sdk': '1' } }),
        },
        {
          path: 'src/agent.ts',
          content: "import OpenAI from 'openai';\nconst model = 'gpt-4o';\ncreateReactAgent();\n",
        },
        {
          path: '.mcp.json',
          content: JSON.stringify({ mcpServers: { files: { command: 'npx' } } }),
        },
      ],
    });
    const [row] = materializeAgentManifests(discovery, { discoveryMethod: 'github' });
    assert.ok(row);
    assert.equal(row.fields.owner, 'unknown');
    assert.equal(row.fields.permissions, 'unknown');
    assert.equal(row.fields.dataAccess, 'unknown');
    assert.equal(row.fields.governance, 'unknown');
    assert.equal(row.manifest.owner, undefined);
    assert.equal(row.manifest.permissions, undefined);
    assert.equal(row.manifest.dataAccess, undefined);
    assert.equal(row.manifest.governance, undefined);
    assert.equal(row.fields.models, 'observed');
    assert.equal(row.fields.mcpServers, 'observed');
    assert.equal(row.manifest.source?.discoveryMethod, 'github');
    assert.equal(row.manifest.status, 'discovered');
  });

  test('returns no manifests when discovery found no candidates', () => {
    const discovery = discoverRepository({
      repository: 'https://github.com/acme/docs',
      branch: 'main',
      files: [{ path: 'README.md', content: 'hello' }],
    });
    assert.deepEqual(materializeAgentManifests(discovery), []);
  });
});

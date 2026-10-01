import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  GITHUB_FETCH_LIMITS,
  parseGithubRepoUrl,
  isHighSignalPath,
  selectDiscoveryFiles,
  fetchGithubSnapshot,
} from './github.js';

describe('parseGithubRepoUrl', () => {
  test('accepts owner/repo URLs', () => {
    const p = parseGithubRepoUrl('https://github.com/aking-beep/ark');
    assert.deepEqual(p, { owner: 'aking-beep', repo: 'ark' });
  });

  test('strips .git and optional www', () => {
    const p = parseGithubRepoUrl('https://www.github.com/acme/bot.git');
    assert.equal(p?.owner, 'acme');
    assert.equal(p?.repo, 'bot');
  });

  test('reads a tree branch', () => {
    const p = parseGithubRepoUrl('https://github.com/acme/bot/tree/release');
    assert.equal(p?.branch, 'release');
  });

  test('rejects non-github hosts and path traversal', () => {
    assert.equal(parseGithubRepoUrl('https://gitlab.com/acme/bot'), null);
    assert.equal(parseGithubRepoUrl('https://github.com/../etc'), null);
    assert.equal(parseGithubRepoUrl('not a url'), null);
  });
});

describe('file bounding', () => {
  test('skips node_modules, .env secrets, and keeps high-signal names', () => {
    assert.equal(isHighSignalPath('package.json'), true);
    assert.equal(isHighSignalPath('src/agent.ts'), true);
    assert.equal(isHighSignalPath('node_modules/openai/index.js'), false);
    assert.equal(isHighSignalPath('.env'), false);
    assert.equal(isHighSignalPath('.env.example'), true);
  });

  test('caps selected files at the documented limit', () => {
    const paths = Array.from({ length: 80 }, (_, i) => `src/agent-${i}.ts`);
    const { selected, skipped, warnings } = selectDiscoveryFiles(paths);
    assert.equal(selected.length, GITHUB_FETCH_LIMITS.maxFiles);
    assert.equal(skipped, 40);
    assert.ok(warnings.some((w) => w.includes('Capped')));
  });
});

describe('fetchGithubSnapshot', () => {
  test('selects high-signal blobs and never logs the token', async () => {
    const calls: { url: string; auth?: string }[] = [];
    const fetchFn = (async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
      const url = String(input);
      const headers = init?.headers as Record<string, string> | undefined;
      calls.push({ url, auth: headers?.authorization });
      if (url.endsWith('/repos/acme/bot')) {
        return new Response(JSON.stringify({ default_branch: 'main' }), { status: 200 });
      }
      if (url.includes('/git/trees/')) {
        return new Response(
          JSON.stringify({
            sha: 'abc123def456',
            tree: [
              { path: 'package.json', type: 'blob', size: 80 },
              { path: 'node_modules/x.js', type: 'blob', size: 10 },
              { path: 'README.md', type: 'blob', size: 40 },
            ],
          }),
          { status: 200 },
        );
      }
      if (url.includes('/contents/package.json')) {
        return new Response(
          JSON.stringify({ encoding: 'base64', content: Buffer.from('{"name":"bot"}').toString('base64'), size: 14 }),
          { status: 200 },
        );
      }
      if (url.includes('/contents/README.md')) {
        return new Response(
          JSON.stringify({ encoding: 'base64', content: Buffer.from('# bot').toString('base64'), size: 5 }),
          { status: 200 },
        );
      }
      return new Response('no', { status: 404 });
    }) as typeof fetch;

    const snap = await fetchGithubSnapshot({
      ref: { owner: 'acme', repo: 'bot' },
      token: 'secret-token-value',
      fetchFn,
    });
    assert.equal(snap.repository, 'https://github.com/acme/bot');
    assert.equal(snap.branch, 'main');
    assert.equal(snap.commitSha, 'abc123def456');
    assert.equal(snap.files.length, 2);
    assert.ok(snap.files.every((f) => f.path !== 'node_modules/x.js'));
    assert.ok(calls.some((c) => c.auth === 'Bearer secret-token-value'));
    assert.equal(JSON.stringify(snap).includes('secret-token-value'), false);
  });

  test('skips files over the per-file byte cap', async () => {
    const fetchFn = (async (input: Parameters<typeof fetch>[0]) => {
      const url = String(input);
      if (url.endsWith('/repos/acme/bot')) {
        return new Response(JSON.stringify({ default_branch: 'main' }), { status: 200 });
      }
      if (url.includes('/git/trees/')) {
        return new Response(
          JSON.stringify({ sha: 's', tree: [{ path: 'agent.ts', type: 'blob', size: 90_000 }] }),
          { status: 200 },
        );
      }
      if (url.includes('/contents/agent.ts')) {
        return new Response(JSON.stringify({ encoding: 'base64', content: '', size: 90_000 }), { status: 200 });
      }
      return new Response('no', { status: 404 });
    }) as typeof fetch;
    const snap = await fetchGithubSnapshot({ ref: { owner: 'acme', repo: 'bot' }, fetchFn });
    assert.equal(snap.files.length, 0);
    assert.ok(snap.warnings.some((w) => w.includes('larger than')));
  });
});

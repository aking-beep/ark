#!/usr/bin/env node
import { chromium } from 'playwright';
import path from 'node:path';
import { AgentManifest, runAssurance } from '@ark/core';
import { upsertAgent, createAssuranceRun } from '@ark/db';

const DIR = path.join(process.cwd(), 'evidence/agent-control-v01');
const VIEWPORT = { width: 1440, height: 900 };

const manifest = AgentManifest.parse({
  id: 'support-agent',
  name: 'Support triage',
  purpose: 'Triage inbound tickets. Fixture for evidence screenshots.',
  owner: 'sam',
  status: 'registered',
  environment: 'production',
  riskLevel: 'high',
  source: {
    repository: 'https://github.com/acme/support-bot',
    branch: 'main',
    commitSha: 'abc123',
    discoveryMethod: 'snapshot',
  },
  models: [{ provider: 'anthropic', modelId: 'claude-haiku-4.5', purpose: 'triage' }],
  tools: [{ name: 'lookup_ticket', type: 'function' }],
  mcpServers: [{ name: 'github', transport: 'stdio' }],
  integrations: [{ name: 'stripe', type: 'saas' }],
  discovery: { evidencePaths: ['src/agent.ts', 'package.json'], confidence: 0.7 },
});

await upsertAgent('org_demo', manifest, { owner: 'sam', environment: 'production', status: 'registered' });
await createAssuranceRun('org_demo', 'support-agent', runAssurance(manifest));

const browser = await chromium.launch({ executablePath: '/usr/local/bin/google-chrome' });
const ctx = await browser.newContext({ viewport: VIEWPORT });
const page = await ctx.newPage();
page.setDefaultTimeout(60_000);

const waitCss = () =>
  page
    .waitForFunction(() => {
      const bg = getComputedStyle(document.body).backgroundColor;
      return bg !== 'rgba(0, 0, 0, 0)';
    })
    .catch(() => {});

await page.goto('http://localhost:3002/login', { waitUntil: 'networkidle' });
await waitCss();
await page.fill('input[name="email"]', 'dana@riverbend.example');
await page.fill('input[name="password"]', 'riverbend-demo');
await Promise.all([
  page.waitForURL('**/dashboard', { timeout: 30_000 }),
  page.click('button[type="submit"]'),
]);

for (const name of ['discover', 'agents', 'assurance', 'dashboard']) {
  await page.goto(`http://localhost:3002/${name}`, { waitUntil: 'networkidle' });
  await waitCss();
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(DIR, `after-${name}.png`), fullPage: true });
  console.log(`/ ${name} → after-${name}.png`);
}

await page.goto('http://localhost:3002/agents/support-agent', { waitUntil: 'networkidle' });
await waitCss();
await page.waitForTimeout(400);
await page.screenshot({ path: path.join(DIR, 'after-agent-detail.png'), fullPage: true });
console.log('/ agents/support-agent → after-agent-detail.png');

await browser.close();

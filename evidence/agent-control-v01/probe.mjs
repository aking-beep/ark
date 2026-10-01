#!/usr/bin/env node
/**
 * Before/after probe for agent-control-v01.
 * Same command twice. Missing pieces print ABSENT.
 */
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const out = [];
const line = (k, v) => out.push(`${k.padEnd(52)} ${v}`);
const ABSENT = 'ABSENT';
const DIR = 'evidence/agent-control-v01';
mkdirSync(DIR, { recursive: true });

async function tryImport(spec) {
  try {
    return await import(spec);
  } catch {
    return null;
  }
}

async function get(url) {
  try {
    const res = await fetch(url, { redirect: 'manual' });
    const body = await res.text().catch(() => '');
    return { status: res.status, body };
  } catch (err) {
    return { status: 0, body: String(err) };
  }
}

const core = await tryImport('@ark/core');
line('@ark/core resolves', core ? 'yes' : ABSENT);
line('AgentManifest export', typeof core?.AgentManifest?.safeParse === 'function' ? 'yes' : ABSENT);
line('discoverRepository export', typeof core?.discoverRepository === 'function' ? 'yes' : ABSENT);
line('materializeAgentManifests export', typeof core?.materializeAgentManifests === 'function' ? 'yes' : ABSENT);
line('runAssurance export', typeof core?.runAssurance === 'function' ? 'yes' : ABSENT);
line('evaluatePolicy export', typeof core?.evaluatePolicy === 'function' ? 'yes' : ABSENT);
line('parseGithubRepoUrl export', typeof core?.parseGithubRepoUrl === 'function' ? 'yes' : ABSENT);

let manifestOk = ABSENT;
if (typeof core?.AgentManifest?.safeParse === 'function') {
  const parsed = core.AgentManifest.safeParse({
    id: 'support-agent',
    name: 'Support triage',
    purpose: 'Triage tickets',
    owner: 'sam',
    environment: 'production',
    riskLevel: 'high',
  });
  manifestOk = parsed.success ? 'yes' : `no (${parsed.error?.issues?.[0]?.message ?? 'fail'})`;
}
line('minimal manifest parses', manifestOk);

let giantRejected = ABSENT;
if (typeof core?.AgentManifest?.safeParse === 'function') {
  const giant = core.AgentManifest.safeParse({
    id: 'x',
    name: 'x',
    purpose: 'x'.repeat(20_000),
  });
  giantRejected = giant.success ? 'ACCEPTED GIANT' : 'yes';
}
line('giant purpose rejected', giantRejected);

let urlParse = ABSENT;
if (typeof core?.parseGithubRepoUrl === 'function') {
  const p = core.parseGithubRepoUrl('https://github.com/aking-beep/ark');
  urlParse = p && p.owner === 'aking-beep' && p.repo === 'ark' ? 'yes' : `no (${JSON.stringify(p)})`;
}
line('GitHub URL parser', urlParse);

let discoveryRan = ABSENT;
let materializeUnknown = ABSENT;
if (typeof core?.discoverRepository === 'function' && typeof core?.materializeAgentManifests === 'function') {
  const result = core.discoverRepository({
    repository: 'https://github.com/acme/support-bot',
    branch: 'main',
    files: [
      {
        path: 'package.json',
        content: JSON.stringify({
          dependencies: { openai: '4', '@langchain/langgraph': '0.2', '@modelcontextprotocol/sdk': '1' },
        }),
      },
      {
        path: 'src/agent.ts',
        content: "import { createReactAgent } from '@langchain/langgraph/prebuilt';\nconst model = 'gpt-4o';\ncreateReactAgent();\n",
      },
      {
        path: '.mcp.json',
        content: JSON.stringify({ mcpServers: { github: { command: 'npx' } } }),
      },
    ],
  });
  const hasEvidence = result.evidence.length > 0 && result.mcpServers.some((s) => s.name === 'github');
  discoveryRan = hasEvidence ? `yes (confidence ${result.confidence})` : 'no evidence';
  const [row] = core.materializeAgentManifests(result);
  materializeUnknown =
    row && row.fields.owner === 'unknown' && row.manifest.owner === undefined ? 'yes' : 'invented owner';
}
line('discoverRepository on fixture', discoveryRan);
line('materialize leaves owner unknown', materializeUnknown);

let assuranceFail = ABSENT;
if (typeof core?.runAssurance === 'function') {
  const report = core.runAssurance({
    id: 'refund-agent',
    name: 'Refunds',
    environment: 'production',
    riskLevel: 'high',
  });
  assuranceFail = report.overallStatus === 'fail' ? 'yes' : report.overallStatus;
}
line('assurance fails production missing owner', assuranceFail);

let bounds = ABSENT;
if (typeof core?.selectDiscoveryFiles === 'function' && core?.GITHUB_FETCH_LIMITS) {
  const paths = Array.from({ length: 80 }, (_, i) => `src/agent-${i}.ts`);
  const { selected } = core.selectDiscoveryFiles(paths);
  bounds = selected.length === core.GITHUB_FETCH_LIMITS.maxFiles ? 'yes' : `capped at ${selected.length}`;
}
line('file cap 40', bounds);

const db = await tryImport('@ark/db');
line('@ark/db resolves', db ? 'yes' : ABSENT);
line('listAgents export', typeof db?.listAgents === 'function' ? 'yes' : ABSENT);
line('DDL mentions agents table', (await import('node:fs')).readFileSync('packages/db/src/sql.ts', 'utf8').includes('CREATE TABLE IF NOT EXISTS agents') ? 'yes' : ABSENT);

const rt = await tryImport('@ark/runtime');
line('RuntimeRequest.agentId optional', (() => {
  if (typeof rt?.RuntimeRequest?.safeParse !== 'function') return ABSENT;
  const ok = rt.RuntimeRequest.safeParse({ messages: [{ role: 'user', content: 'hi' }] });
  const withId = rt.RuntimeRequest.safeParse({
    messages: [{ role: 'user', content: 'hi' }],
    agentId: 'support-agent',
  });
  return ok.success && withId.success ? 'yes' : 'no';
})());

const discover = await get('http://localhost:3002/discover');
const agents = await get('http://localhost:3002/agents');
const assurance = await get('http://localhost:3002/assurance');
line('GET :3002/discover (anon)', discover.status === 0 ? ABSENT : String(discover.status));
line('GET :3002/agents (anon)', agents.status === 0 ? ABSENT : String(agents.status));
line('GET :3002/assurance (anon)', assurance.status === 0 ? ABSENT : String(assurance.status));

async function authed(path) {
  try {
    const login = await fetch('http://localhost:3002/api/session', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'dana@riverbend.example', password: 'riverbend-demo' }),
      redirect: 'manual',
    });
    const cookie = login.headers.get('set-cookie') ?? '';
    const token = /ark_session=([^;]+)/.exec(cookie)?.[1];
    if (!token) return { status: 0, body: 'no session' };
    const res = await fetch(`http://localhost:3002${path}`, {
      headers: { cookie: `ark_session=${token}` },
      redirect: 'manual',
    });
    return { status: res.status, body: await res.text() };
  } catch (err) {
    return { status: 0, body: String(err) };
  }
}

const dAuth = await authed('/discover');
const aAuth = await authed('/agents');
const sAuth = await authed('/assurance');
const detailAuth = await authed('/agents/support-agent');
line('GET /discover authed', dAuth.status === 0 ? ABSENT : String(dAuth.status));
line('GET /agents authed', aAuth.status === 0 ? ABSENT : String(aAuth.status));
line('GET /assurance authed', sAuth.status === 0 ? ABSENT : String(sAuth.status));
line('GET /agents/support-agent authed', detailAuth.status === 0 ? ABSENT : String(detailAuth.status));
line('/agents/support-agent names Support', /Support triage/i.test(detailAuth.body) && detailAuth.status === 200 ? 'yes' : ABSENT);
line('/discover names GitHub', dAuth.body.includes('github.com') || dAuth.body.includes('GitHub') ? 'yes' : ABSENT);
line('/agents names Agent', /agent/i.test(aAuth.body) && aAuth.status === 200 ? 'yes' : ABSENT);
line('nav has Discover', aAuth.body.includes('Discover') || dAuth.body.includes('Discover') ? 'yes' : ABSENT);
line('docs/09-agent-control-v01.md', existsSync('docs/09-agent-control-v01.md') ? 'yes' : ABSENT);

const text = out.join('\n') + '\n';
writeFileSync(path.join(DIR, 'last-probe.txt'), text);
console.log(text);

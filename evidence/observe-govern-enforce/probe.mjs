#!/usr/bin/env node
/**
 * Before/after probe for observe-govern-enforce.
 * Same command twice. Missing pieces print ABSENT.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const out = [];
const line = (k, v) => out.push(`${k.padEnd(56)} ${v}`);
const ABSENT = 'ABSENT';
const DIR = 'evidence/observe-govern-enforce';
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

async function loginCookie() {
  const email = process.env.ARK_DEMO_EMAIL || 'dana@riverbend.example';
  const password = process.env.ARK_DEMO_PASSWORD || 'riverbend-demo';
  const res = await fetch('http://localhost:3002/api/session', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password }),
    redirect: 'manual',
  });
  const set = res.headers.getSetCookie?.() ?? [];
  const cookie = set.map((c) => c.split(';')[0]).join('; ');
  return cookie || res.headers.get('set-cookie')?.split(';')[0] || '';
}

const core = await tryImport('@ark/core');
line('@ark/core resolves', core ? 'yes' : ABSENT);
line('enforceAgentPolicies export', typeof core?.enforceAgentPolicies === 'function' ? 'yes' : ABSENT);
line('DEFAULT_AGENT_POLICIES export', Array.isArray(core?.DEFAULT_AGENT_POLICIES) ? 'yes' : ABSENT);

let enforceDeny = ABSENT;
let enforceAllow = ABSENT;
if (typeof core?.enforceAgentPolicies === 'function') {
  const deny = core.enforceAgentPolicies({
    id: 'support-agent',
    name: 'Support',
    environment: 'production',
    dataAccess: { dataClasses: ['pii'] },
  });
  enforceDeny = deny.allowed === false ? 'yes (denied)' : `allowed=${deny.allowed}`;
  const allow = core.enforceAgentPolicies({
    id: 'support-agent',
    name: 'Support',
    environment: 'production',
    dataAccess: { dataClasses: ['pii'] },
    governance: { policyRefs: ['pol_production_pii'], evaluationRefs: ['eval_1'], humanEscalation: true },
  });
  enforceAllow = allow.allowed === true ? 'yes (allowed)' : `allowed=${allow.allowed}`;
}
line('enforce denies production PII without governance', enforceDeny);
line('enforce allows production PII with governance', enforceAllow);

let ddl = '';
try {
  ddl = readFileSync('packages/db/src/sql.ts', 'utf8');
} catch {
  ddl = '';
}
function tableHasColumn(source, table, column) {
  const m = source.match(new RegExp(`CREATE TABLE IF NOT EXISTS ${table} \\(([\\s\\S]*?)\\)`));
  return Boolean(m && m[1].includes(column));
}
line('DDL actions.agent_id', tableHasColumn(ddl, 'actions', 'agent_id') ? 'yes' : ABSENT);
line('DDL protocol_evidence.agent_id', tableHasColumn(ddl, 'protocol_evidence', 'agent_id') ? 'yes' : ABSENT);

let treeFailClosed = ABSENT;
if (typeof core?.fetchGithubSnapshot === 'function') {
  const fetchFn = (async (input) => {
    const url = String(input);
    if (url.endsWith('/repos/acme/huge')) {
      return new Response(JSON.stringify({ default_branch: 'main' }), { status: 200 });
    }
    if (url.includes('/git/trees/')) {
      return new Response(
        JSON.stringify({
          sha: 'deadbeef',
          truncated: true,
          tree: [{ path: 'agent.ts', type: 'blob', size: 20 }],
        }),
        { status: 200 },
      );
    }
    if (url.includes('/contents/')) {
      return new Response(
        JSON.stringify({ encoding: 'base64', content: Buffer.from('oops').toString('base64'), size: 4 }),
        { status: 200 },
      );
    }
    return new Response('no', { status: 404 });
  });
  const snap = await core.fetchGithubSnapshot({ ref: { owner: 'acme', repo: 'huge' }, fetchFn });
  treeFailClosed =
    snap.files.length === 0 && snap.warnings.some((w) => /truncat|fail closed|failed closed/i.test(w))
      ? 'yes'
      : `files=${snap.files.length} warnings=${JSON.stringify(snap.warnings)}`;
}
line('truncated tree fail-closed (0 files)', treeFailClosed);

let liveGithub = ABSENT;
if (typeof core?.fetchGithubSnapshot === 'function') {
  try {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), 15_000);
    const snap = await core.fetchGithubSnapshot({
      ref: { owner: 'octocat', repo: 'Hello-World' },
      fetchFn: (url, init) => fetch(url, { ...init, signal: ac.signal }),
    });
    clearTimeout(timer);
    const n = snap.files.length;
    const warn = snap.warnings[0] ? ` warn=${snap.warnings[0].slice(0, 80)}` : '';
    liveGithub = n > 0 || snap.warnings.length > 0 ? `yes (files=${n}${warn})` : 'empty';
    if (JSON.stringify(snap).toLowerCase().includes('bearer ')) liveGithub = 'LEAKED TOKEN';
  } catch (err) {
    liveGithub = `error ${String(err).slice(0, 120)}`;
  }
}
line('live GitHub fetch octocat/Hello-World', liveGithub);

let executeBlocked = ABSENT;
const runtime = await tryImport('@ark/runtime');
if (typeof runtime?.execute === 'function' && typeof core?.enforceAgentPolicies === 'function') {
  let called = 0;
  const adapter = {
    id: 'openai-compatible',
    catalogProvider: 'openai',
    residency: 'cloud',
    latencyClass: 'standard',
    capabilities: ['text'],
    configured: () => true,
    defaultModel: () => 'gpt-5-nano',
    complete: async () => {
      called++;
      return {
        text: 'should-not-run',
        modelId: 'gpt-4o-mini',
        adapterId: 'openai-compatible',
        catalogProvider: 'openai',
        inputTokens: 1,
        outputTokens: 1,
        latencyMs: 1,
        finishReason: 'stop',
      };
    },
  };
  try {
    await runtime.execute(
      { messages: [{ role: 'user', content: 'hi' }], agentId: 'support-agent' },
      {
        adapters: [adapter],
        agent: {
          id: 'support-agent',
          name: 'Support',
          environment: 'production',
          dataAccess: { dataClasses: ['pii'] },
        },
      },
    );
    executeBlocked = `RAN complete() called=${called}`;
  } catch (err) {
    const name = err?.name ?? '';
    executeBlocked =
      name === 'PolicyError' && called === 0 ? 'yes (PolicyError, complete=0)' : `${name} complete=${called}`;
  }
} else if (typeof runtime?.execute === 'function') {
  executeBlocked = ABSENT;
}
line('execute blocks production PII agent (no complete)', executeBlocked);

const anonDiscover = await get('http://localhost:3002/discover');
line('GET :3002/discover (anon)', anonDiscover.status === 0 ? ABSENT : String(anonDiscover.status));

let authedDiscover = ABSENT;
let authedAgents = ABSENT;
let navCalibration = ABSENT;
try {
  const cookie = await loginCookie();
  if (cookie) {
    const d = await fetch('http://localhost:3002/discover', { headers: { cookie }, redirect: 'manual' });
    authedDiscover = String(d.status);
    const body = await d.text();
    const a = await fetch('http://localhost:3002/agents', { headers: { cookie }, redirect: 'manual' });
    authedAgents = String(a.status);
    navCalibration = /Calibration/.test(body) ? 'yes' : ABSENT;
  }
} catch (err) {
  authedDiscover = `error ${String(err).slice(0, 80)}`;
}
line('GET /discover authed', authedDiscover);
line('GET /agents authed', authedAgents);
line('nav has Calibration', navCalibration);

const text = out.join('\n') + '\n';
process.stdout.write(text);
writeFileSync(path.join(DIR, 'last-probe.txt'), text);

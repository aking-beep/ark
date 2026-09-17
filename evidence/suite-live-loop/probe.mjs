#!/usr/bin/env node
/**
 * Same command before and after:
 *   node evidence/suite-live-loop/probe.mjs
 * Tree inspection plus optional live POST :3001/api/measure. Prints no secrets.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const INVOICE_LOOKUP = {
  id: 'wl_invoice_lookup',
  name: 'Look up invoice totals for account queries',
  description: 'Staff look up an invoice by number and read back the total.',
  actor: 'employee',
  task: ['lookup', 'calculate'],
  volume: { unitsPerMonth: 3000, unitLabel: 'query' },
  input: { modality: ['text'], avgTokens: 120, sourceSystems: ['NetSuite'], requiresExternalKnowledge: true },
  output: { modality: ['structured'], avgTokens: 60, mustBeStructured: true },
  determinism: 'exact',
  errorTolerance: 'none',
  dataClasses: ['financial'],
  autonomy: 'suggest',
  current: { minutesPerUnit: 3, fullyLoadedHourlyUsd: 32 },
  team: { engineers: 2, hasMlExperience: false, hasSecurityReview: true },
};

const SUPPORT_TRIAGE = {
  id: 'wl_support_triage',
  name: 'Support ticket triage and refund handling',
  description: '40 agents read inbound tickets, check Salesforce, and issue refunds where warranted.',
  actor: 'employee',
  task: ['classify', 'extract', 'decide', 'act'],
  volume: { unitsPerMonth: 12000, unitLabel: 'ticket', variability: 'bursty' },
  input: { modality: ['text'], avgTokens: 900, sourceSystems: ['Zendesk', 'Salesforce'], requiresExternalKnowledge: true },
  output: { modality: ['structured'], avgTokens: 250, mustBeStructured: true },
  determinism: 'tolerant',
  errorTolerance: 'low',
  multiStep: true,
  dataClasses: ['pii', 'financial'],
  actions: [
    { name: 'Tag and route ticket', system: 'Zendesk', write: true, blastRadius: 'reversible' },
    { name: 'Issue refund', system: 'Salesforce', write: true, blastRadius: 'costly', valueCeilingUsd: 100 },
  ],
  autonomy: 'bounded',
  latencyBudgetMs: 8000,
  regulated: ['ccpa'],
  dataResidency: 'us',
  current: { minutesPerUnit: 7, fullyLoadedHourlyUsd: 38, humanErrorRate: 0.04 },
  team: { engineers: 3, hasMlExperience: false, hasSecurityReview: true, canOperate247: false },
};

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');

function read(rel) {
  return readFileSync(join(root, rel), 'utf8');
}

const measure = read('apps/business/src/lib/measure.ts');
const route = read('apps/business/src/app/api/measure/route.ts');
const report = read('apps/business/src/app/report/page.tsx');
const sample = read('apps/business/src/components/measure-sample.tsx');
const registry = read('apps/consumer/src/app/registry/page.tsx');
const methodology = read('apps/consumer/src/app/methodology/page.tsx');
const login = read('apps/control/src/app/login/page.tsx');
const freshness = read('my-ai/packages/core/src/myai/freshness.py');
const readme = read('my-ai/README.md');

const measureSampleAt = report.indexOf('<MeasureSample');
const uncalibratedAt = report.indexOf('This report is uncalibrated');
const footerAt = report.indexOf('Assess another workload');

const tree = {
  passesCatalogPrimaryAsModel: measure.includes('assessment.model.primary.id'),
  mentionsOllamaModelEnv: measure.includes('ARK_OLLAMA_MODEL') || route.includes('ARK_OLLAMA_MODEL'),
  registryHardcoded12Sep: registry.includes('12 September 2026'),
  methodologyHardcoded12Sep: methodology.includes('12 September 2026'),
  freshnessHasLastReviewed: freshness.includes('last_reviewed'),
  readmeDate: (readme.match(/last reviewed on ([0-9-]+)/i) || [null, 'MISSING'])[1],
  measureSampleIndex: measureSampleAt,
  uncalibratedIndex: uncalibratedAt,
  footerIndex: footerAt,
  measureBeforeFooter: measureSampleAt > -1 && footerAt > -1 && measureSampleAt < footerAt,
  measureNearUncalibrated:
    measureSampleAt > -1 &&
    uncalibratedAt > -1 &&
    Math.abs(measureSampleAt - uncalibratedAt) < 800,
  clientAbort: sample.includes('AbortSignal') || sample.includes('AbortController'),
  loginMentionsLocalhost: login.includes('localhost:3002'),
  loginMentions127: login.includes('127.0.0.1'),
  loginMentionsCookie: /cookie/i.test(login),
};

async function postMeasure(body) {
  const res = await fetch('http://127.0.0.1:3001/api/measure', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(20_000),
  });
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = { raw: text.slice(0, 240) };
  }
  return {
    status: res.status,
    ok: json.ok ?? null,
    reason: json.reason ?? null,
    message: typeof json.message === 'string' ? json.message.slice(0, 220) : null,
    modelId: json.modelId ?? null,
    mentionsLocal70b: `${json.message ?? ''} ${json.modelId ?? ''}`.includes('local-70b'),
  };
}

let http = { tried: false };
try {
  const get = await fetch('http://127.0.0.1:3001/api/measure', {
    method: 'GET',
    signal: AbortSignal.timeout(1500),
  });
  const getText = await get.text();
  http = {
    tried: true,
    getStatus: get.status,
    getNamesOllamaModel: getText.includes('ARK_OLLAMA_MODEL'),
    notAi: await postMeasure(INVOICE_LOOKUP),
    support: await postMeasure(SUPPORT_TRIAGE),
  };
} catch (err) {
  http = { tried: true, error: err instanceof Error ? err.message : 'error' };
}

console.log(JSON.stringify({ tree, http }, null, 2));

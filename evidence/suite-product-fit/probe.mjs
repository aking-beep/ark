#!/usr/bin/env node
/**
 * Same command before and after:
 *   node evidence/suite-product-fit/probe.mjs
 * Tree inspection plus optional GET :3001/api/measure. Prints no secrets.
 */
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');

function read(rel) {
  return readFileSync(join(root, rel), 'utf8');
}

function countRe(src, re) {
  return [...src.matchAll(re)].length;
}

const products = JSON.parse(read('my-ai/data/registry/products.json'));
const models = JSON.parse(read('my-ai/data/registry/models.json'));
const results = read('apps/consumer/src/components/results-view.tsx');
const intake = read('apps/business/src/components/intake.tsx');
const empty = read('apps/control/src/app/dashboard/page.tsx');
const login = read('apps/control/src/app/login/page.tsx');
const report = read('apps/business/src/app/report/page.tsx');
const businessPkg = JSON.parse(read('apps/business/package.json'));

const minutesDefault = /minutesPerUnit[^\n]*useState<number \| ''>\(([^)]+)\)/.exec(intake)?.[1] ?? 'MISSING';
const hourlyDefault = /hourlyUsd[^\n]*useState<number \| ''>\(([^)]+)\)/.exec(intake)?.[1] ?? 'MISSING';

const tree = {
  products: products.length,
  productIds: products.map((p) => p.id).sort(),
  models: models.length,
  modelIds: models.map((m) => m.id).sort(),
  duplicateItemKeys: countRe(results, /key=\{item\}/g),
  todayMinutesDefault: minutesDefault.trim(),
  todayHourlyDefault: hourlyDefault.trim(),
  businessDependsRuntime: Boolean(businessPkg.dependencies?.['@ark/runtime']),
  appsRuntimeDir: existsSync(join(root, 'apps/runtime')),
  measureRouteExists: existsSync(join(root, 'apps/business/src/app/api/measure/route.ts')),
  emptyMentionsSetup: empty.includes('npm run setup'),
  emptyMentionsMeasure: empty.includes('/api/measure'),
  emptyMentionsTokenEnv: empty.includes('ARK_CONTROL_TOKEN'),
  emptyContainsBearerSecret: /ark_dev_ingest/.test(empty),
  loginMentionsMeasure: login.includes('/api/measure'),
  reportMentionsTokenEnv: report.includes('ARK_CONTROL_TOKEN'),
  reportHasMeasureControl: report.includes('MeasureSample'),
};

let http = { tried: false };
try {
  const res = await fetch('http://127.0.0.1:3001/api/measure', {
    method: 'GET',
    signal: AbortSignal.timeout(1500),
  });
  const text = await res.text();
  http = {
    tried: true,
    status: res.status,
    namesMeasure: text.includes('/api/measure') || text.includes('POST'),
    bodySnippet: text.slice(0, 240),
  };
} catch (err) {
  http = { tried: true, error: err instanceof Error ? err.name : 'error' };
}

console.log(JSON.stringify({ tree, http }, null, 2));

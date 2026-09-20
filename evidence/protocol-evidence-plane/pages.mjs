#!/usr/bin/env node
/**
 * Route sweep for the protocol-evidence-plane evidence. Walks every Control
 * page as the seeded demo org and then as Northwind, which has no protocol
 * evidence at all — the second pass is what proves the new page degrades to an
 * empty state rather than a 500.
 *
 * Each org gets its own browser context so the two sessions cannot collide.
 *
 * Usage: node evidence/protocol-evidence-plane/pages.mjs
 */
import { chromium } from 'playwright';
import path from 'node:path';

const BASE = process.env.ARK_CONTROL_URL ?? 'http://localhost:3002';
const DIR = path.join(process.cwd(), 'evidence/protocol-evidence-plane');
const VIEWPORT = { width: 1440, height: 900 };

const ROUTES = [
  '/dashboard',
  '/workloads',
  '/workloads/wl_support_triage',
  '/optimize',
  '/budgets',
  '/calibration',
  '/protocols',
];

const browser = await chromium.launch({ executablePath: '/usr/local/bin/google-chrome' });

async function sweep(label, email, password) {
  const ctx = await browser.newContext({ viewport: VIEWPORT });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));

  await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' });
  await page.fill('input[name="email"]', email);
  await page.fill('input[name="password"]', password);
  await Promise.all([
    page.waitForURL('**/dashboard', { timeout: 30_000 }),
    page.click('button[type="submit"]'),
  ]);

  console.log(`\n${label} (${email})`);
  for (const route of ROUTES) {
    const res = await page.goto(`${BASE}${route}`, { waitUntil: 'networkidle', timeout: 60_000 });
    const status = res?.status();
    console.log(`  ${String(status).padEnd(4)} ${route}`);
    if (status !== 200) process.exitCode = 1;
  }

  await ctx.close();
  return errors;
}

const demoErrors = await sweep('demo org — seeded', 'dana@riverbend.example', 'riverbend-demo');

// Northwind is seeded with zero events, so /protocols has nothing to roll up.
const nwCtx = await browser.newContext({ viewport: VIEWPORT });
const nwPage = await nwCtx.newPage();
const nwErrors = [];
nwPage.on('pageerror', (e) => nwErrors.push(String(e)));
await nwPage.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' });
await nwPage.fill('input[name="email"]', 'sam@northwind.example');
await nwPage.fill('input[name="password"]', 'northwind-demo');
await Promise.all([
  nwPage.waitForURL('**/dashboard', { timeout: 30_000 }),
  nwPage.click('button[type="submit"]'),
]);

console.log('\nnorthwind — no protocol evidence');
for (const route of ROUTES) {
  // The demo org's workload must 404 here: that 404 is the tenancy boundary,
  // not a broken page.
  const want = route === '/workloads/wl_support_triage' ? 404 : 200;
  const res = await nwPage.goto(`${BASE}${route}`, { waitUntil: 'networkidle', timeout: 60_000 });
  const status = res?.status();
  console.log(`  ${String(status).padEnd(4)} ${route}${want === 404 ? '   (expected — other org)' : ''}`);
  if (status !== want) process.exitCode = 1;
}

await nwPage.goto(`${BASE}/protocols`, { waitUntil: 'networkidle' });
await nwPage.waitForTimeout(400);
await nwPage.screenshot({ path: path.join(DIR, 'after-protocols-empty.png'), fullPage: true });
console.log('\n  → after-protocols-empty.png');

console.log(`\nuncaught page errors: demo=${demoErrors.length} northwind=${nwErrors.length}`);
for (const e of [...demoErrors, ...nwErrors]) console.log(`  ${e}`);
if (demoErrors.length || nwErrors.length) process.exitCode = 1;

await browser.close();

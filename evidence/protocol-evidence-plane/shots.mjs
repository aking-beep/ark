#!/usr/bin/env node
/**
 * Screenshot capture for the protocol-evidence-plane evidence, so the before
 * and after images are taken at the same viewport, the same routes, the same
 * org and by the same code path. A screenshot with no stated viewport is a
 * picture, not evidence (factory/03-PROVE.md).
 *
 * Usage: node evidence/protocol-evidence-plane/shots.mjs before|after
 */
import { chromium } from 'playwright';
import path from 'node:path';

const phase = process.argv[2];
if (phase !== 'before' && phase !== 'after') {
  console.error('usage: node shots.mjs before|after');
  process.exit(2);
}

const BASE = process.env.ARK_CONTROL_URL ?? 'http://localhost:3002';
const DIR = path.join(process.cwd(), 'evidence/protocol-evidence-plane');
const VIEWPORT = { width: 1440, height: 900 };

const browser = await chromium.launch({ executablePath: '/usr/local/bin/google-chrome' });
const ctx = await browser.newContext({ viewport: VIEWPORT });
const page = await ctx.newPage();

await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' });
await page.fill('input[name="email"]', 'dana@riverbend.example');
await page.fill('input[name="password"]', 'riverbend-demo');
await Promise.all([page.waitForURL('**/dashboard', { timeout: 30_000 }), page.click('button[type="submit"]')]);

async function shot(route, name) {
  const res = await page.goto(`${BASE}${route}`, { waitUntil: 'networkidle', timeout: 60_000 });
  await page.waitForTimeout(600);
  await page.screenshot({ path: path.join(DIR, `${phase}-${name}.png`), fullPage: true });
  console.log(`${route.padEnd(34)} ${res?.status()}  → ${phase}-${name}.png`);
}

await shot('/protocols', 'protocols');
await shot('/dashboard', 'dashboard');
await shot('/workloads/wl_support_triage', 'workload');
await shot('/budgets', 'budgets');

await browser.close();

#!/usr/bin/env node
/**
 * The measurement for action-receipts-view, run identically for `before` and
 * `after`:
 *
 *   node evidence/action-receipts-view/shots.mjs before|after [baseUrl]
 *
 * Expects Control running under `next start` (production build) on a fresh
 * `npm run db:bootstrap` database, reachable on localhost (the session cookie is
 * `Secure`, which Chromium honours on localhost and not on 127.0.0.1).
 *
 * For each signed-in org and viewport it records the HTTP status of the route,
 * whether the page scrolls horizontally (scrollWidth > clientWidth), and a
 * full-page screenshot. Results go to <phase>.txt next to this script.
 */
import { chromium } from 'playwright';
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PHASE = process.argv[2];
if (PHASE !== 'before' && PHASE !== 'after') {
  console.error('usage: node shots.mjs before|after [baseUrl]');
  process.exit(2);
}
const BASE = process.argv[3] ?? 'http://localhost:3002';
const DIR = path.dirname(fileURLToPath(import.meta.url));
const VIEWPORTS = [
  { name: '1280', width: 1280, height: 900 },
  { name: '390', width: 390, height: 844 },
];
const ORGS = [
  { name: 'demo', email: 'dana@riverbend.example', password: 'riverbend-demo', routes: ['actions', 'budgets'] },
  { name: 'northwind', email: 'sam@northwind.example', password: 'northwind-demo', routes: ['actions'] },
];

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const lines = [`phase=${PHASE} base=${BASE} captured=${new Date().toISOString()}`];

for (const org of ORGS) {
  for (const vp of VIEWPORTS) {
    const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height } });
    const page = await ctx.newPage();
    page.setDefaultTimeout(60_000);
    await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' });
    await page.fill('input[name="email"]', org.email);
    await page.fill('input[name="password"]', org.password);
    await Promise.all([page.waitForURL('**/dashboard'), page.click('button[type="submit"]')]);

    for (const route of org.routes) {
      const res = await page.goto(`${BASE}/${route}`, { waitUntil: 'networkidle' });
      await page.waitForTimeout(300);
      const m = await page.evaluate(() => {
        const el = document.scrollingElement ?? document.documentElement;
        return {
          scrollWidth: el.scrollWidth,
          clientWidth: el.clientWidth,
          rows: document.querySelectorAll('[data-receipt-row]').length,
          h1: document.querySelector('h1')?.textContent?.trim() ?? '',
          nav: [...document.querySelectorAll('nav a')].some((a) => a.textContent?.trim() === 'Actions'),
        };
      });
      const file = `${PHASE}-${route}-${org.name}-${vp.name}.png`;
      await page.screenshot({ path: path.join(DIR, file), fullPage: true });
      lines.push(
        `org=${org.name} route=/${route} viewport=${vp.width}x${vp.height} status=${res?.status()} ` +
          `h1=${JSON.stringify(m.h1)} navActions=${m.nav} receiptRows=${m.rows} ` +
          `scrollWidth=${m.scrollWidth} clientWidth=${m.clientWidth} hScroll=${m.scrollWidth > m.clientWidth} file=${file}`,
      );
      console.log(lines.at(-1));
    }
    await ctx.close();
  }
}

await browser.close();
writeFileSync(path.join(DIR, `${PHASE}.txt`), lines.join('\n') + '\n');

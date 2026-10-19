#!/usr/bin/env node
/**
 * Keyboard and header-alignment probe for /actions (after only: before, the
 * route is a 404 and there is nothing to probe).
 *
 *   node evidence/action-receipts-view/a11y.mjs [baseUrl]
 *
 * Signs in as Demo Co at 1280x900 and records:
 *   - the order of focus stops reached with Tab from the top of the page
 *     (up to 40), so a reader can see the table region and each correlation
 *     id are reachable without a mouse;
 *   - that Enter on the first correlation <summary> reveals the full id;
 *   - for every column of the receipts table, the header's computed
 *     text-align against its cells' (they must match), and that every <th>
 *     has scope="col".
 * Writes a11y.txt next to this script.
 */
import { chromium } from 'playwright';
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const BASE = process.argv[2] ?? 'http://localhost:3002';
const DIR = path.dirname(fileURLToPath(import.meta.url));
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const page = await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
const out = [`a11y probe base=${BASE} viewport=1280x900 captured=${new Date().toISOString()}`];

await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' });
await page.fill('input[name="email"]', 'dana@riverbend.example');
await page.fill('input[name="password"]', 'riverbend-demo');
await Promise.all([page.waitForURL('**/dashboard'), page.click('button[type="submit"]')]);
await page.goto(`${BASE}/actions`, { waitUntil: 'networkidle' });

out.push('', 'Tab order (first 40 stops):');
for (let i = 1; i <= 40; i++) {
  await page.keyboard.press('Tab');
  const d = await page.evaluate(() => {
    const el = document.activeElement;
    if (!el || el === document.body) return null;
    const label = el.getAttribute('aria-label') ?? el.textContent?.replace(/\s+/g, ' ').trim().slice(0, 60);
    return `${el.tagName.toLowerCase()}${el.getAttribute('role') ? `[role=${el.getAttribute('role')}]` : ''} "${label}"`;
  });
  out.push(`  ${String(i).padStart(2)}. ${d ?? '(body)'}`);
}

const firstSummary = page.locator('table summary').first();
await firstSummary.focus();
await page.keyboard.press('Enter');
const opened = await page.evaluate(() => {
  const d = document.querySelector('table details');
  return { open: d?.open ?? false, full: d?.querySelector('p')?.textContent ?? '' };
});
out.push('', `Enter on first correlation summary: open=${opened.open} fullIdLength=${opened.full.length}`);

const cols = await page.evaluate(() => {
  const table = document.querySelector('table[aria-label="Action receipts"]');
  if (!table) return null;
  const ths = [...table.querySelectorAll('thead th')];
  const rows = [...table.querySelectorAll('tbody tr')];
  return ths.map((th, i) => {
    const cells = rows.map((r) => r.children[i]).filter(Boolean);
    const cellAligns = [...new Set(cells.map((c) => getComputedStyle(c).textAlign))];
    return {
      header: th.textContent?.trim(),
      scope: th.getAttribute('scope'),
      headerAlign: getComputedStyle(th).textAlign,
      cellAligns,
    };
  });
});
out.push('', 'Receipts table columns (header align vs cell align):');
let mismatches = 0;
for (const c of cols ?? []) {
  const ok = c.cellAligns.length === 1 && c.cellAligns[0] === c.headerAlign && c.scope === 'col';
  if (!ok) mismatches++;
  out.push(`  ${c.header?.padEnd(16)} scope=${c.scope} header=${c.headerAlign} cells=${c.cellAligns.join('/')} ${ok ? 'ok' : 'MISMATCH'}`);
}
out.push(`columns=${cols?.length ?? 0} mismatches=${mismatches}`);

await browser.close();
writeFileSync(path.join(DIR, 'a11y.txt'), out.join('\n') + '\n');
console.log(out.join('\n'));

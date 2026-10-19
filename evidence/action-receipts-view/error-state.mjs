#!/usr/bin/env node
/**
 * The /actions error boundary, provoked for real: run Control (`next start`)
 * on a copy of the bootstrapped database with `action_receipts` dropped, so
 * the org-scoped read throws inside the server component.
 *
 *   setup, by the caller: copy the bootstrapped DB, run `DROP TABLE
 *   action_receipts` on the copy (via @libsql/client), and `next start` on it;
 *   node evidence/action-receipts-view/error-state.mjs [baseUrl]
 *
 * Records the HTTP status, the boundary's heading and whether the page
 * leaked a stack or SQL text, and saves after-actions-error-1280.png.
 */
import { chromium } from 'playwright';
import { appendFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const BASE = process.argv[2] ?? 'http://localhost:3002';
const DIR = path.dirname(fileURLToPath(import.meta.url));
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const page = await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' });
await page.fill('input[name="email"]', 'dana@riverbend.example');
await page.fill('input[name="password"]', 'riverbend-demo');
await Promise.all([page.waitForURL('**/dashboard'), page.click('button[type="submit"]')]);
const res = await page.goto(`${BASE}/actions`, { waitUntil: 'networkidle' });
await page.waitForSelector('[role="alert"]');
const m = await page.evaluate(() => ({
  heading: document.querySelector('[role="alert"] h1')?.textContent ?? '',
  leak: /no such table|SQLITE|at .*\.js:\d+/i.test(document.body.innerText),
}));
await page.screenshot({ path: path.join(DIR, 'after-actions-error-1280.png'), fullPage: true });
const line = `error-state route=/actions viewport=1280x900 status=${res?.status()} heading=${JSON.stringify(m.heading)} leaksInternals=${m.leak} file=after-actions-error-1280.png`;
appendFileSync(path.join(DIR, 'after.txt'), line + '\n');
console.log(line);
await browser.close();

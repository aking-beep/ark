#!/usr/bin/env node
import { chromium } from 'playwright';
import path from 'node:path';

const phase = process.argv[2];
if (phase !== 'before' && phase !== 'after') {
  console.error('usage: node shots.mjs before|after');
  process.exit(2);
}
const DIR = path.join(process.cwd(), 'evidence/suite-competitive-loop');
const VIEWPORT = { width: 1440, height: 900 };
const browser = await chromium.launch({ executablePath: '/usr/local/bin/google-chrome' });
const ctx = await browser.newContext({ viewport: VIEWPORT });
const page = await ctx.newPage();
page.setDefaultTimeout(60_000);

const waitCss = () => page.waitForFunction(() => {
  const bg = getComputedStyle(document.body).backgroundColor;
  return bg !== 'rgba(0, 0, 0, 0)';
}).catch(() => {});

async function shot(url, name, fullPage = false) {
  const res = await page.goto(url, { waitUntil: 'networkidle', timeout: 60_000 });
  await waitCss();
  await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(DIR, `${phase}-${name}.png`), fullPage });
  console.log(`${url.padEnd(42)} ${res?.status()} → ${phase}-${name}.png`);
}

await shot('http://localhost:3000/', 'consumer');
await shot('http://localhost:3001/', 'teams');

await page.goto('http://localhost:3002/login', { waitUntil: 'networkidle' });
await waitCss();
await page.fill('input[name="email"]', 'sam@northwind.example');
await page.fill('input[name="password"]', 'northwind-demo');
await Promise.all([page.waitForURL('**/dashboard', { timeout: 30_000 }), page.click('button[type="submit"]')]);
await waitCss();
await page.waitForTimeout(600);
await page.screenshot({ path: path.join(DIR, `${phase}-control-empty.png`) });
console.log(`${'http://localhost:3002/dashboard (northwind)'.padEnd(42)} 200 → ${phase}-control-empty.png`);

await page.goto('http://localhost:3002/start', { waitUntil: 'networkidle' });
await waitCss();
await page.waitForTimeout(400);
await page.screenshot({ path: path.join(DIR, `${phase}-control-start.png`), fullPage: true });
console.log(`http://localhost:3002/start (northwind)        ${page.url()} → ${phase}-control-start.png`);

await page.click('button:has-text("Sign out")');
await page.waitForURL('**/login', { timeout: 30_000 });
await waitCss();
await page.fill('input[name="email"]', 'dana@riverbend.example');
await page.fill('input[name="password"]', 'riverbend-demo');
await Promise.all([page.waitForURL('**/dashboard', { timeout: 30_000 }), page.click('button[type="submit"]')]);
await page.goto('http://localhost:3002/start', { waitUntil: 'networkidle' });
await waitCss();
await page.waitForTimeout(400);
await page.screenshot({ path: path.join(DIR, `${phase}-control-start-seeded.png`), fullPage: true });
console.log(`http://localhost:3002/start (demo co)          ${page.url()} → ${phase}-control-start-seeded.png`);

await browser.close();

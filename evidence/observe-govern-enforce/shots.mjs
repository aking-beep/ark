#!/usr/bin/env node
import { chromium } from 'playwright';
import path from 'node:path';

const phase = process.argv[2] === 'after' ? 'after' : 'before';
const DIR = path.join(process.cwd(), 'evidence/observe-govern-enforce');
const VIEWPORT = { width: 1440, height: 900 };
const live = process.argv.includes('--live-discover');

const browser = await chromium.launch({ executablePath: '/usr/local/bin/google-chrome' });
const ctx = await browser.newContext({ viewport: VIEWPORT });
const page = await ctx.newPage();
page.setDefaultTimeout(90_000);

const waitCss = () =>
  page
    .waitForFunction(() => getComputedStyle(document.body).backgroundColor !== 'rgba(0, 0, 0, 0)')
    .catch(() => {});

await page.goto('http://localhost:3002/login', { waitUntil: 'networkidle' });
await waitCss();
await page.fill('input[name="email"]', 'dana@riverbend.example');
await page.fill('input[name="password"]', 'riverbend-demo');
await Promise.all([
  page.waitForURL('**/dashboard', { timeout: 30_000 }),
  page.click('button[type="submit"]'),
]);

const pages = live
  ? ['discover', 'agents', 'assurance', 'dashboard']
  : ['discover', 'dashboard'];

for (const name of pages) {
  await page.goto(`http://localhost:3002/${name}`, { waitUntil: 'networkidle' });
  await waitCss();
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(DIR, `${phase}-${name}.png`), fullPage: true });
  console.log(`/${name} → ${phase}-${name}.png`);
}

if (live) {
  await page.goto('http://localhost:3002/discover', { waitUntil: 'networkidle' });
  await waitCss();
  await page.fill('input[name="repository"]', 'https://github.com/aking-beep/ark');
  await page.fill('input[name="branch"]', 'main');
  await Promise.all([
    page.waitForURL(/\/discover\?run=/, { timeout: 60_000 }),
    page.click('button[type="submit"]'),
  ]);
  await waitCss();
  await page.waitForTimeout(800);
  await page.screenshot({ path: path.join(DIR, 'after-discover-live.png'), fullPage: true });
  console.log('/discover?run= → after-discover-live.png');

  const register = page.locator('form[action] button:has-text("Register")').first();
  if (await register.count()) {
    await Promise.all([
      page.waitForURL(/\/agents\//, { timeout: 30_000 }),
      register.click(),
    ]);
    await waitCss();
    await page.waitForTimeout(600);
    await page.screenshot({ path: path.join(DIR, 'after-agent-detail.png'), fullPage: true });
    console.log('registered agent → after-agent-detail.png');
  } else {
    console.log('no Register button (no candidates) — live discover still captured');
  }
}

await browser.close();

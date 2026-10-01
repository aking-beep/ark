#!/usr/bin/env node
import { chromium } from 'playwright';
import path from 'node:path';

const DIR = path.join(process.cwd(), 'evidence/agent-control-v01');
const VIEWPORT = { width: 1440, height: 900 };
const browser = await chromium.launch({ executablePath: '/usr/local/bin/google-chrome' });
const ctx = await browser.newContext({ viewport: VIEWPORT });
const page = await ctx.newPage();
page.setDefaultTimeout(60_000);

const waitCss = () =>
  page
    .waitForFunction(() => {
      const bg = getComputedStyle(document.body).backgroundColor;
      return bg !== 'rgba(0, 0, 0, 0)';
    })
    .catch(() => {});

async function login(email, password) {
  await page.goto('http://localhost:3002/login', { waitUntil: 'networkidle' });
  await waitCss();
  await page.fill('input[name="email"]', email);
  await page.fill('input[name="password"]', password);
  await Promise.all([
    page.waitForURL('**/dashboard', { timeout: 30_000 }),
    page.click('button[type="submit"]'),
  ]);
}

await login('dana@riverbend.example', 'riverbend-demo');

for (const name of ['discover', 'agents', 'assurance', 'dashboard']) {
  await page.goto(`http://localhost:3002/${name}`, { waitUntil: 'networkidle' });
  await waitCss();
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(DIR, `after-${name}.png`), fullPage: true });
  console.log(`/ ${name} → after-${name}.png`);
}

await browser.close();

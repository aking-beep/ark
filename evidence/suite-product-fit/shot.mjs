import { chromium } from 'playwright';
import { writeFileSync } from 'node:fs';

const dir = 'evidence/suite-product-fit';
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

await page.goto('http://localhost:3002/login', { waitUntil: 'networkidle' });
await page.screenshot({ path: `${dir}/after-control-login.png`, fullPage: true });
writeFileSync(`${dir}/after-control-login.html`, await page.content());

await page.fill('input[name="email"]', 'sam@northwind.example');
await page.fill('input[name="password"]', 'northwind-demo');
await page.click('button[type="submit"]');
await page.waitForURL(/dashboard/, { timeout: 15000 });
await page.getByText('No telemetry yet').waitFor({ timeout: 15000 });
await page.screenshot({ path: `${dir}/after-control-empty.png`, fullPage: true });
writeFileSync(`${dir}/after-control-empty.html`, await page.content());

await page.goto('http://localhost:3001/assess', { waitUntil: 'networkidle' });
await page.screenshot({ path: `${dir}/after-teams-assess.png`, fullPage: true });

await browser.close();
console.log('screenshots ok');

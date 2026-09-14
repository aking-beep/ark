/**
 * Model catalog audit.
 *
 *   npm run refresh:models
 *
 * This script does NOT fetch prices and does not rewrite the catalog.
 *
 * That is deliberate. Vendor pricing lives on marketing pages that change
 * layout, hide rates behind tiers, and quote promotional numbers next to
 * standard ones. A scraper that gets that wrong produces a catalog entry
 * stamped `benchmark` and dated today, which is worse than a stale entry —
 * a stale entry is at least honestly labelled as old.
 *
 * So this audits instead: it tells you exactly which entries need a human to
 * look at a price page, and which promotional rates are about to lapse. A
 * lapsing promotional rate is the most common way a correct forecast becomes
 * wrong with nobody having changed anything.
 *
 * Exit code 1 if anything needs attention, so it can gate CI.
 *
 * Reads the built package, so run `npm run build:packages` first (or just
 * `npm run setup`, which does).
 */

import { CATALOG, staleEntries, type ModelEntry, type Provider } from '@ark/core';

const MAX_AGE_DAYS = Number(process.env.ARK_PRICE_MAX_AGE_DAYS ?? 45);
const EXPIRY_WARN_DAYS = 30;

/** Where a human goes to re-verify. Kept here rather than in the catalog
 *  because it is operational trivia, not a property of the model. */
const PRICE_SOURCES: Record<Provider, string> = {
  anthropic: 'https://www.anthropic.com/pricing',
  openai: 'https://openai.com/api/pricing/',
  google: 'https://ai.google.dev/pricing',
  bedrock: 'https://aws.amazon.com/bedrock/pricing/',
  local: '(self-hosted — cost is your infrastructure, not a list price)',
};

const now = new Date();
const days = (a: Date, b: Date) => Math.round((a.getTime() - b.getTime()) / 86_400_000);

const stale = staleEntries(now, MAX_AGE_DAYS);

const expiring = CATALOG.filter((m) => {
  if (!m.priceExpiresOn) return false;
  const d = days(new Date(m.priceExpiresOn), now);
  return d <= EXPIRY_WARN_DAYS;
});

const missingCachedRate = CATALOG.filter(
  (m) => m.provider !== 'local' && m.cachedInputPer1M === undefined,
);

const line = (m: ModelEntry) =>
  `  ${m.id.padEnd(28)} ${m.provider.padEnd(10)} ` +
  `$${String(m.inputPer1M).padStart(6)} / $${String(m.outputPer1M).padStart(6)} per 1M   ` +
  `asOf ${m.asOf} (${days(now, new Date(m.asOf))}d ago)`;

console.log(`\nARK model catalog audit — ${now.toISOString().slice(0, 10)}`);
console.log(`${CATALOG.length} entries, staleness threshold ${MAX_AGE_DAYS} days\n`);

if (stale.length) {
  console.log(`STALE — re-verify these against the vendor price page (${stale.length}):`);
  stale.forEach((m) => console.log(line(m)));
  const providers = [...new Set(stale.map((m) => m.provider))];
  console.log('\n  Sources:');
  providers.forEach((p) => console.log(`    ${p.padEnd(10)} ${PRICE_SOURCES[p]}`));
  console.log();
}

if (expiring.length) {
  console.log(`PROMOTIONAL RATE LAPSING within ${EXPIRY_WARN_DAYS} days (${expiring.length}):`);
  expiring.forEach((m) => {
    const d = days(new Date(m.priceExpiresOn!), now);
    const when = d < 0 ? `EXPIRED ${-d}d ago` : `in ${d}d`;
    console.log(`  ${m.id.padEnd(28)} expires ${m.priceExpiresOn} (${when})`);
    if (m.notes) console.log(`    note: ${m.notes}`);
  });
  console.log();
}

if (missingCachedRate.length) {
  console.log(`NO CACHED-READ RATE (${missingCachedRate.length}) — cost model will assume no cache discount:`);
  missingCachedRate.forEach((m) => console.log(`  ${m.id}`));
  console.log();
}

const issues = stale.length + expiring.length;

if (!issues && !missingCachedRate.length) {
  console.log('All entries current. Nothing to do.\n');
}

if (issues) {
  console.log('To update: edit packages/core/src/models/catalog.ts, correct the rate,');
  console.log('and bump `asOf` to the date you actually looked. Do not bump `asOf`');
  console.log('without looking — a fresh date on an unchecked number is the exact');
  console.log('failure this catalog exists to prevent.\n');
  process.exit(1);
}

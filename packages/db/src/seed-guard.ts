/**
 * The seed wipes every table and writes demo users with published passwords
 * and published ingest tokens. That is the right thing on a laptop and a
 * breach anywhere else, so in production it has to be asked for twice: once
 * with ARK_ALLOW_SEED=1, and again by supplying real credentials for every
 * account and token it creates.
 */

/** Values that ship in this repository, and therefore are not secrets. */
export const DEFAULT_SEED_SECRETS: Readonly<Record<string, string>> = {
  ARK_DEMO_PASSWORD: 'riverbend-demo',
  ARK_NORTHWIND_PASSWORD: 'northwind-demo',
  ARK_INGEST_TOKEN_DEMO: 'ark_dev_ingest_org_demo',
  ARK_INGEST_TOKEN_NORTHWIND: 'ark_dev_ingest_org_northwind',
};

export interface SeedGuardResult {
  ok: boolean;
  /** One line per problem, naming the variable — never its value. */
  problems: string[];
}

export function seedGuard(env: Record<string, string | undefined> = process.env): SeedGuardResult {
  if (env.NODE_ENV !== 'production') return { ok: true, problems: [] };
  const problems: string[] = [];
  if (env.ARK_ALLOW_SEED !== '1') {
    problems.push('NODE_ENV=production: seeding is refused unless ARK_ALLOW_SEED=1.');
    return { ok: false, problems };
  }
  for (const [name, published] of Object.entries(DEFAULT_SEED_SECRETS)) {
    const v = env[name]?.trim();
    if (!v) {
      problems.push(`${name} must be set in production.`);
    } else if (v === published || v.startsWith('ark_dev_ingest_')) {
      problems.push(`${name} is a published default; set a real value.`);
    } else if (name.includes('PASSWORD') && v.length < 12) {
      problems.push(`${name} must be at least 12 characters.`);
    } else if (name.includes('TOKEN') && v.length < 24) {
      problems.push(`${name} must be at least 24 characters.`);
    }
  }
  return { ok: problems.length === 0, problems };
}

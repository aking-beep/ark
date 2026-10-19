/**
 * `npm run bootstrap` — safe to run on every boot (deploy/entrypoint.sh does).
 *
 *   1. Push the schema. Idempotent, and re-keys tables created before the
 *      (org_id, id) primary keys.
 *   2. Seed, but only when the `orgs` table is empty. A database that already
 *      holds a tenant is never wiped, which is what makes it safe to point
 *      several replicas at one shared libSQL database.
 *
 * In production the seed is additionally gated by seed-guard.ts. A production
 * database that is empty and not cleared for seeding is left empty with a
 * warning rather than failing the boot; one that asked to be seeded
 * (ARK_ALLOW_SEED=1) but carries default credentials fails loudly.
 */
import { createClient, type Client } from '@libsql/client';
import { pathToFileURL } from 'node:url';
import { databaseUrl } from './client.js';
import { pushSchema } from './sql.js';
import { seedGuard } from './seed-guard.js';

export type BootstrapOutcome = 'seeded' | 'already-seeded' | 'seed-skipped';

export async function bootstrap(opts: {
  client?: Client;
  env?: Record<string, string | undefined>;
  seed?: () => Promise<void>;
  log?: (line: string) => void;
} = {}): Promise<BootstrapOutcome> {
  const client = opts.client ?? createClient({ url: databaseUrl(), authToken: process.env.ARK_DATABASE_AUTH_TOKEN });
  const env = opts.env ?? process.env;
  const log = opts.log ?? ((line: string) => console.log(line));

  const { rebuilt } = await pushSchema(client);
  if (rebuilt.length) log(`Re-keyed ${rebuilt.join(', ')} to (org_id, id).`);
  log('Schema pushed.');

  const orgs = await client.execute('SELECT COUNT(*) n FROM orgs');
  if (Number(orgs.rows[0]?.n ?? 0) > 0) {
    log('Database already has orgs; not seeding.');
    return 'already-seeded';
  }

  const guard = seedGuard(env);
  if (!guard.ok && env.ARK_ALLOW_SEED !== '1') {
    log(`Empty database left unseeded: ${guard.problems.join(' ')}`);
    return 'seed-skipped';
  }
  if (!guard.ok) {
    throw new Error(`Seed refused:\n  ${guard.problems.join('\n  ')}`);
  }

  const seed = opts.seed ?? (async () => {
    const { runSeed } = await import('./seed.js');
    await runSeed();
  });
  await seed();
  log('Seeded an empty database.');
  return 'seeded';
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  try {
    await bootstrap();
  } catch (err) {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  }
}

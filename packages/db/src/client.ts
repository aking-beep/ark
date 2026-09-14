import { createClient } from '@libsql/client';
import { drizzle } from 'drizzle-orm/libsql';
import * as schema from './schema.js';
import path from 'node:path';

/**
 * Resolves to a file in the repo root by default so every app in the monorepo
 * shares one database in development without any configuration.
 */
export function databaseUrl(): string {
  if (process.env.ARK_DATABASE_URL) return process.env.ARK_DATABASE_URL;
  const root = process.env.ARK_ROOT ?? findRepoRoot();
  return `file:${path.join(root, 'ark.db')}`;
}

function findRepoRoot(): string {
  let dir = process.cwd();
  for (let i = 0; i < 6; i++) {
    if (dir.endsWith('ark')) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return process.cwd();
}

let _db: ReturnType<typeof drizzle<typeof schema>> | null = null;

export function db() {
  if (!_db) {
    const client = createClient({
      url: databaseUrl(),
      authToken: process.env.ARK_DATABASE_AUTH_TOKEN,
    });
    _db = drizzle(client, { schema });
  }
  return _db;
}

export { schema };
export * from './schema.js';

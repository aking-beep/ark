import { createClient } from '@libsql/client';
import { databaseUrl } from './client.js';
import { DDL, MIGRATIONS } from './sql.js';

const url = databaseUrl();
const client = createClient({ url, authToken: process.env.ARK_DATABASE_AUTH_TOKEN });
for (const stmt of DDL) await client.execute(stmt);
for (const stmt of MIGRATIONS) {
  try {
    await client.execute(stmt);
  } catch {
    // Duplicate column on an already-migrated file. Fresh DBs already have it in DDL.
  }
}
console.log(`Schema pushed to ${url}`);

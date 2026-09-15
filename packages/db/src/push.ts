import { createClient } from '@libsql/client';
import { databaseUrl } from './client.js';
import { DDL } from './sql.js';

const url = databaseUrl();
const client = createClient({ url, authToken: process.env.ARK_DATABASE_AUTH_TOKEN });
for (const stmt of DDL) await client.execute(stmt);
console.log(`Schema pushed to ${url}`);

import { createClient } from '@libsql/client';
import { databaseUrl } from './client.js';
import { pushSchema } from './sql.js';

const url = databaseUrl();
const client = createClient({ url, authToken: process.env.ARK_DATABASE_AUTH_TOKEN });
const { rebuilt } = await pushSchema(client);
if (rebuilt.length) console.log(`Re-keyed ${rebuilt.join(', ')} to (org_id, id).`);
console.log(`Schema pushed to ${url}`);

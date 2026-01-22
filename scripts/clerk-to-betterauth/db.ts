import { Pool } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-serverless';

import * as schemaModule from '../../packages/database/src/schemas';
import { getDatabaseUrl } from './config';

const databaseUrl = getDatabaseUrl();

const pool = new Pool({ connectionString: databaseUrl });
const db = drizzle(pool, { schema: schemaModule });

export { db, pool };
export * as schema from '../../packages/database/src/schemas';

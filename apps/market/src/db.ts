import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';

import * as schema from '../../../packages/database/src/schemas/market';

export const createMarketDatabase = (connectionString: string) => {
  const pool = new Pool({ connectionString });

  return drizzle(pool, { schema });
};

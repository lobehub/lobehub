import { neonConfig, Pool as NeonPool } from '@neondatabase/serverless';
import { drizzle as neonDrizzle } from 'drizzle-orm/neon-serverless';
import { drizzle as nodeDrizzle } from 'drizzle-orm/node-postgres';
import { Pool as NodePool } from 'pg';
import ws from 'ws';

import { serverDBEnv } from '@/config/db';

import * as schema from '../schemas';
import type { LobeChatDatabase } from '../type';

export const getDBInstance = (): LobeChatDatabase => {
  // In test environment, return a mock instance to avoid initialization errors
  if (process.env.NODE_ENV === 'test') return {} as LobeChatDatabase;

  if (!serverDBEnv.KEY_VAULTS_SECRET) {
    throw new Error(
      ` \`KEY_VAULTS_SECRET\` is not set, please set it in your environment variables.

If you don't have it, please run \`openssl rand -base64 32\` to create one.
`,
    );
  }

  const connectionString = serverDBEnv.DATABASE_URL;

  if (!connectionString) {
    throw new Error(`You are try to use database, but "DATABASE_URL" is not set correctly`);
  }

  if (serverDBEnv.DATABASE_DRIVER === 'node') {
    const client = new NodePool({ connectionString });
    return nodeDrizzle(client, { schema });
  }

  if (process.env.MIGRATION_DB === '1') {
    // https://github.com/neondatabase/serverless/blob/main/CONFIG.md#websocketconstructor-typeof-websocket--undefined
    neonConfig.webSocketConstructor = ws;
  }

  const client = new NeonPool({ connectionString });
  return neonDrizzle(client, { schema });
};

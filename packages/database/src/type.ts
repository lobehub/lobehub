import type { NeonDatabase } from 'drizzle-orm/neon-serverless';

import type * as schema from './schemas';

export type LobeChatDatabaseSchema = typeof schema;

export type LobeChatDatabase = NeonDatabase<LobeChatDatabaseSchema>;

export type Transaction = Parameters<Parameters<LobeChatDatabase['transaction']>[0]>[0];

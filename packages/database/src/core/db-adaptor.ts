import type { LobeChatDatabase } from '../type';
import { getDBInstance } from './web-server';

/**
 * Lazy-load database instance
 * Avoid initializing the database every time the module is imported
 */
let cachedDB: LobeChatDatabase | null = null;

export const getServerDB = async (): Promise<LobeChatDatabase> => {
  // If there's already a cached instance, return it directly
  if (cachedDB) return cachedDB;

  try {
    // Select the appropriate database instance based on the environment
    cachedDB = getDBInstance();
    return cachedDB;
  } catch (error) {
    console.error('❌ Failed to initialize database:', error);
    throw error;
  }
};

export const serverDB = getDBInstance();

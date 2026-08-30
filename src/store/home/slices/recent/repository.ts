import { localDatabase } from '@/libs/localDatabase';
import type { RecentItem } from '@/server/routers/lambda/recent';

const COLLECTION = 'home-recent-query';
const CACHE_VERSION = 1;

interface PersistedRecentQuery {
  items: RecentItem[];
  updatedAt: number;
  version: number;
}

const keyOf = (scope: string, queryKey: string) => `${scope}::${queryKey}`;

export const recentQueryRepository = {
  get: async (scope: string, queryKey: string): Promise<PersistedRecentQuery | undefined> => {
    try {
      const value = await localDatabase.get<PersistedRecentQuery>(
        COLLECTION,
        keyOf(scope, queryKey),
      );
      return value?.version === CACHE_VERSION ? value : undefined;
    } catch {
      return undefined;
    }
  },
  set: async (scope: string, queryKey: string, items: RecentItem[]): Promise<void> => {
    try {
      await localDatabase.set(COLLECTION, keyOf(scope, queryKey), {
        items,
        updatedAt: Date.now(),
        version: CACHE_VERSION,
      } satisfies PersistedRecentQuery);
    } catch {
      // Local query persistence is best-effort; the server remains the durable SoT.
    }
  },
};

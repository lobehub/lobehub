import type { RecentItem } from '@lobechat/types';

export type RecentEntityRef = `${RecentItem['type']}:${string}`;

export const createRecentQueryKey = (limit: number): string => `limit:${limit}`;

export interface RecentOptimisticTitle {
  mutationId: number;
  title: string;
}

export interface RecentScopeState {
  optimisticTitles: Partial<Record<RecentEntityRef, RecentOptimisticTitle>>;
  queries: Record<string, RecentQueryState>;
}

export interface RecentQueryState {
  items: RecentItem[];
  updatedAt: number;
}

export interface RecentState {
  allRecentsDrawerOpen: boolean;
  recentsByScope: Record<string, RecentScopeState>;
}

const RECENT_STORAGE_KEY = 'lobechat-home-recents';
const RECENT_STORAGE_VERSION = 1;

interface PersistedRecentState {
  queriesByScope: Record<string, RecentScopeState['queries']>;
  version: number;
}

export const loadRecentScopes = (): RecentState['recentsByScope'] => {
  if (typeof window === 'undefined') return {};

  try {
    const value = localStorage.getItem(RECENT_STORAGE_KEY);
    if (!value) return {};
    const persisted = JSON.parse(value) as PersistedRecentState;
    if (persisted.version !== RECENT_STORAGE_VERSION) return {};

    return Object.fromEntries(
      Object.entries(persisted.queriesByScope).map(([scope, queries]) => [
        scope,
        {
          optimisticTitles: {},
          queries: Object.fromEntries(
            Object.entries(queries).map(([queryKey, query]) => [
              queryKey,
              {
                ...query,
                items: query.items.map((item) => ({
                  ...item,
                  updatedAt: new Date(item.updatedAt),
                })),
              },
            ]),
          ),
        },
      ]),
    );
  } catch {
    return {};
  }
};

export const persistRecentQueries = (recentsByScope: RecentState['recentsByScope']): void => {
  if (typeof window === 'undefined') return;

  try {
    localStorage.setItem(
      RECENT_STORAGE_KEY,
      JSON.stringify({
        queriesByScope: Object.fromEntries(
          Object.entries(recentsByScope).map(([scope, state]) => [scope, state.queries]),
        ),
        version: RECENT_STORAGE_VERSION,
      } satisfies PersistedRecentState),
    );
  } catch {
    // Local projection persistence is best-effort; the server remains the durable SoT.
  }
};

export const initialRecentState: RecentState = {
  allRecentsDrawerOpen: false,
  recentsByScope: loadRecentScopes(),
};

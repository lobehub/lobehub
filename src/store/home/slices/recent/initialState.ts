import type { RecentItem } from '@lobechat/types';

export type RecentEntityRef = `${RecentItem['type']}:${string}`;

export const createRecentQueryKey = (limit: number): string => `limit:${limit}`;

export interface RecentOptimisticTitle {
  mutationId: number;
  title: string;
}

export interface RecentScopeState {
  hydrationStatusByQuery: Record<string, 'failed' | 'hydrated' | 'hydrating'>;
  optimisticTitles: Partial<Record<RecentEntityRef, RecentOptimisticTitle>>;
  queries: Record<string, RecentQueryState>;
  syncStatusByQuery: Record<string, RecentSyncState>;
}

export interface RecentQueryState {
  items: RecentItem[];
  source: 'server' | 'storage';
  updatedAt: number;
}

export interface RecentSyncState {
  error?: unknown;
  isValidating: boolean;
}

export interface RecentState {
  allRecentsDrawerOpen: boolean;
  recentsByScope: Record<string, RecentScopeState>;
}

export const initialRecentState: RecentState = {
  allRecentsDrawerOpen: false,
  recentsByScope: {},
};

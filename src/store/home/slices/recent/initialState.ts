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

export const initialRecentState: RecentState = {
  allRecentsDrawerOpen: false,
  recentsByScope: {},
};

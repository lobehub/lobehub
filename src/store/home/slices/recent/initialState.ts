import type { RecentItem } from '@lobechat/types';

export type RecentEntityRef = `${RecentItem['type']}:${string}`;

export interface RecentIndex {
  limit: number;
  observedAt: number;
  refs: RecentEntityRef[];
}

export interface RecentOptimisticTitle {
  mutationId: number;
  title: string;
}

export interface RecentScopeState {
  entities: Partial<Record<RecentEntityRef, RecentItem>>;
  index?: RecentIndex;
  optimisticTitles: Partial<Record<RecentEntityRef, RecentOptimisticTitle>>;
}

export interface RecentState {
  allRecentsDrawerOpen: boolean;
  recentsByScope: Record<string, RecentScopeState>;
}

export const initialRecentState: RecentState = {
  allRecentsDrawerOpen: false,
  recentsByScope: {},
};

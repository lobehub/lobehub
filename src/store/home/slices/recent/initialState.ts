import type { RecentItem } from '@lobechat/types';

export type RecentEntityRef = `${RecentItem['type']}:${string}`;

export interface RecentIndex {
  limit: number;
  observedAt: number;
  refs: RecentEntityRef[];
}

export interface RecentState {
  allRecentsDrawerOpen: boolean;
  recentEntitiesByScope: Record<string, Partial<Record<RecentEntityRef, RecentItem>>>;
  recentIndexesByScope: Record<string, RecentIndex>;
  recentOptimisticTitlesByScope: Record<string, Partial<Record<RecentEntityRef, string>>>;
}

export const initialRecentState: RecentState = {
  allRecentsDrawerOpen: false,
  recentEntitiesByScope: {},
  recentIndexesByScope: {},
  recentOptimisticTitlesByScope: {},
};

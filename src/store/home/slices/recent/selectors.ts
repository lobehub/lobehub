import { type HomeStore } from '@/store/home/store';

import type { RecentEntityRef } from './initialState';

const query = (scope: string, queryKey: string) => (s: HomeStore) =>
  s.recentsByScope[scope]?.queries[queryKey];
const syncStatus = (scope: string, queryKey: string) => (s: HomeStore) =>
  s.recentsByScope[scope]?.syncStatusByQuery[queryKey];
const item = (scope: string, queryKey: string, ref: RecentEntityRef) => (s: HomeStore) => {
  const scopedState = s.recentsByScope[scope];
  const recentItem = scopedState?.queries[queryKey]?.items.find(
    (item) => `${item.type}:${item.id}` === ref,
  );
  const optimisticTitle = scopedState?.optimisticTitles[ref]?.title;

  return recentItem && optimisticTitle !== undefined
    ? { ...recentItem, title: optimisticTitle }
    : recentItem;
};

export const homeRecentSelectors = {
  item,
  query,
  syncStatus,
};

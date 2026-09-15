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

  if (!recentItem || optimisticTitle === undefined) return recentItem;

  // A pending task rename has to carry the slug source with it, so the row's
  // link is built from the name the user just typed rather than the one the
  // server still has.
  return recentItem.type === 'task'
    ? { ...recentItem, slugTitle: optimisticTitle, title: optimisticTitle }
    : { ...recentItem, title: optimisticTitle };
};

export const homeRecentSelectors = {
  item,
  query,
  syncStatus,
};

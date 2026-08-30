import { type HomeStore } from '@/store/home/store';

import type { RecentEntityRef } from './initialState';

const refs = (scope: string) => (s: HomeStore) => s.recentIndexesByScope[scope]?.refs || [];
const isRecentsInit = (scope: string) => (s: HomeStore) => !!s.recentIndexesByScope[scope];
const entity = (scope: string, ref: RecentEntityRef) => (s: HomeStore) => {
  const item = s.recentEntitiesByScope[scope]?.[ref];
  const optimisticTitle = s.recentOptimisticTitlesByScope[scope]?.[ref];

  return item && optimisticTitle !== undefined ? { ...item, title: optimisticTitle } : item;
};

export const homeRecentSelectors = {
  entity,
  isRecentsInit,
  refs,
};

import { type HomeStore } from '@/store/home/store';

import type { RecentEntityRef } from './initialState';

const refs = (scope: string) => (s: HomeStore) => s.recentsByScope[scope]?.index?.refs || [];
const isRecentsInit = (scope: string) => (s: HomeStore) => !!s.recentsByScope[scope]?.index;
const entity = (scope: string, ref: RecentEntityRef) => (s: HomeStore) => {
  const scopedState = s.recentsByScope[scope];
  const item = scopedState?.entities[ref];
  const optimisticTitle = scopedState?.optimisticTitles[ref]?.title;

  return item && optimisticTitle !== undefined ? { ...item, title: optimisticTitle } : item;
};

export const homeRecentSelectors = {
  entity,
  isRecentsInit,
  refs,
};

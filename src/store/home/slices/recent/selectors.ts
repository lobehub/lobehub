import { type HomeStore } from '@/store/home/store';

import { type RecentEntityRef, toRecentEntityRef } from './initialState';
import { resourceRecentKey, type ResourceRecentParams } from './projection';

/** Items of one recents query; `undefined` until it is hydrated or fetched. */
const query = (queryKey: string) => (s: HomeStore) => s.recentListMap[queryKey];

const item = (queryKey: string, ref: RecentEntityRef) => (s: HomeStore) =>
  s.recentListMap[queryKey]?.find((recent) => toRecentEntityRef(recent) === ref);

/** Resource home recent files; `undefined` until hydrated or fetched. */
const resourceFiles = (params: ResourceRecentParams) => (s: HomeStore) =>
  s.resourceRecentFilesMap[resourceRecentKey(params)];

/** Resource home recent pages; `undefined` until hydrated or fetched. */
const resourcePages = (params: ResourceRecentParams) => (s: HomeStore) =>
  s.resourceRecentPagesMap[resourceRecentKey(params)];

export const homeRecentSelectors = {
  item,
  query,
  resourceFiles,
  resourcePages,
};

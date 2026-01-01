import isEqual from 'fast-deep-equal';
import type { SWRResponse } from 'swr';
import type { StateCreator } from 'zustand/vanilla';

import { useClientDataSWRWithSync } from '@/libs/swr';
import { fileService } from '@/services/file';
import { topicService } from '@/services/topic';
import type { HomeStore } from '@/store/home/store';
import type { FileListItem } from '@/types/files';
import type { RecentTopic } from '@/types/topic';
import { setNamespace } from '@/utils/storeDebug';

const n = setNamespace('recent');

const FETCH_RECENT_TOPICS_KEY = 'fetchRecentTopics';
const FETCH_RECENT_RESOURCES_KEY = 'fetchRecentResources';
const FETCH_RECENT_PAGES_KEY = 'fetchRecentPages';

export interface RecentAction {
  useFetchRecentPages: (isLogin: boolean | undefined) => SWRResponse<any[]>;
  useFetchRecentResources: (isLogin: boolean | undefined) => SWRResponse<FileListItem[]>;
  useFetchRecentTopics: (isLogin: boolean | undefined) => SWRResponse<RecentTopic[]>;
}

export const createRecentSlice: StateCreator<
  HomeStore,
  [['zustand/devtools', never]],
  [],
  RecentAction
> = (set, get) => ({
  useFetchRecentPages: (isLogin) =>
    useClientDataSWRWithSync<any[]>(
      // Only fetch when login status is explicitly true (not null/undefined)
      isLogin === true ? [FETCH_RECENT_PAGES_KEY, isLogin] : null,
      async () => fileService.getRecentPages(12),
      {
        onData: (data) => {
          if (get().isRecentPagesInit && isEqual(get().recentPages, data)) return;

          set(
            { isRecentPagesInit: true, recentPages: data },
            false,
            n('useFetchRecentPages/onData'),
          );
        },
      },
    ),

  useFetchRecentResources: (isLogin) =>
    useClientDataSWRWithSync<FileListItem[]>(
      // Only fetch when login status is explicitly true (not null/undefined)
      isLogin === true ? [FETCH_RECENT_RESOURCES_KEY, isLogin] : null,
      async () => fileService.getRecentFiles(12),
      {
        onData: (data) => {
          if (get().isRecentResourcesInit && isEqual(get().recentResources, data)) return;

          set(
            { isRecentResourcesInit: true, recentResources: data },
            false,
            n('useFetchRecentResources/onData'),
          );
        },
      },
    ),

  useFetchRecentTopics: (isLogin) =>
    useClientDataSWRWithSync<RecentTopic[]>(
      // Only fetch when login status is explicitly true (not null/undefined)
      isLogin === true ? [FETCH_RECENT_TOPICS_KEY, isLogin] : null,
      async () => topicService.getRecentTopics(12),
      {
        onData: (data) => {
          if (get().isRecentTopicsInit && isEqual(get().recentTopics, data)) return;

          set(
            { isRecentTopicsInit: true, recentTopics: data },
            false,
            n('useFetchRecentTopics/onData'),
          );
        },
      },
    ),
});

import isEqual from 'fast-deep-equal';
import { type SWRResponse } from 'swr';
import { type StateCreator } from 'zustand/vanilla';

import { useClientDataSWR } from '@/libs/swr';
import { fileService } from '@/services/file';
import { topicService } from '@/services/topic';
import { type FileListItem } from '@/types/files';
import { type RecentTopic } from '@/types/topic';
import { setNamespace } from '@/utils/storeDebug';

import { type SessionStore } from '../../store';

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
  SessionStore,
  [['zustand/devtools', never]],
  [],
  RecentAction
> = (set, get) => ({
  useFetchRecentPages: (isLogin) =>
    useClientDataSWR<any[]>(
      // Only fetch when login status is explicitly true (not null/undefined)
      isLogin === true ? [FETCH_RECENT_PAGES_KEY, isLogin] : null,
      async () => fileService.getRecentPages(12),
      {
        onSuccess: (data) => {
          if (get().isRecentPagesInit && isEqual(get().recentPages, data)) return;

          set(
            { isRecentPagesInit: true, recentPages: data },
            false,
            n('useFetchRecentPages/onSuccess'),
          );
        },
      },
    ),

  useFetchRecentResources: (isLogin) =>
    useClientDataSWR<FileListItem[]>(
      // Only fetch when login status is explicitly true (not null/undefined)
      isLogin === true ? [FETCH_RECENT_RESOURCES_KEY, isLogin] : null,
      async () => fileService.getRecentFiles(12),
      {
        onSuccess: (data) => {
          if (get().isRecentResourcesInit && isEqual(get().recentResources, data)) return;

          set(
            { isRecentResourcesInit: true, recentResources: data },
            false,
            n('useFetchRecentResources/onSuccess'),
          );
        },
      },
    ),

  useFetchRecentTopics: (isLogin) =>
    useClientDataSWR<RecentTopic[]>(
      // Only fetch when login status is explicitly true (not null/undefined)
      isLogin === true ? [FETCH_RECENT_TOPICS_KEY, isLogin] : null,
      async () => topicService.getRecentTopics(12),
      {
        onSuccess: (data) => {
          if (get().isRecentTopicsInit && isEqual(get().recentTopics, data)) return;

          set(
            { isRecentTopicsInit: true, recentTopics: data },
            false,
            n('useFetchRecentTopics/onSuccess'),
          );
        },
      },
    ),
});

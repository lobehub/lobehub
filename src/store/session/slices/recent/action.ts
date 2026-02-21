import isEqual from 'fast-deep-equal';
import { type SWRResponse } from 'swr';

import { useClientDataSWR } from '@/libs/swr';
import { fileService } from '@/services/file';
import { topicService } from '@/services/topic';
import { type StoreSetter } from '@/store/types';
import { type FileListItem } from '@/types/files';
import { type RecentTopic } from '@/types/topic';
import { setNamespace } from '@/utils/storeDebug';

import { type SessionStore } from '../../store';

const n = setNamespace('recent');

const FETCH_RECENT_TOPICS_KEY = 'fetchRecentTopics';
const FETCH_RECENT_RESOURCES_KEY = 'fetchRecentResources';
const FETCH_RECENT_PAGES_KEY = 'fetchRecentPages';

type Setter = StoreSetter<SessionStore>;
export const createRecentSlice = (set: Setter, get: () => SessionStore, _api?: unknown) =>
  new RecentActionImpl(set, get, _api);

export class RecentActionImpl {
  readonly #get: () => SessionStore;
  readonly #set: Setter;

  constructor(set: Setter, get: () => SessionStore, _api?: unknown) {
    void _api;
    this.#set = set;
    this.#get = get;
  }

  useFetchRecentPages = (isLogin: boolean | undefined): SWRResponse<any[]> => {
    return useClientDataSWR<any[]>(
      // Only fetch when login status is explicitly true (not null/undefined)
      isLogin === true ? [FETCH_RECENT_PAGES_KEY, isLogin] : null,
      async () => fileService.getRecentPages(12),
      {
        onSuccess: (data) => {
          if (this.#get().isRecentPagesInit && isEqual(this.#get().recentPages, data)) return;

          this.#set(
            { isRecentPagesInit: true, recentPages: data },
            false,
            n('useFetchRecentPages/onSuccess'),
          );
        },
      },
    );
  };

  useFetchRecentResources = (isLogin: boolean | undefined): SWRResponse<FileListItem[]> => {
    return useClientDataSWR<FileListItem[]>(
      // Only fetch when login status is explicitly true (not null/undefined)
      isLogin === true ? [FETCH_RECENT_RESOURCES_KEY, isLogin] : null,
      async () => fileService.getRecentFiles(12),
      {
        onSuccess: (data) => {
          if (this.#get().isRecentResourcesInit && isEqual(this.#get().recentResources, data))
            return;

          this.#set(
            { isRecentResourcesInit: true, recentResources: data },
            false,
            n('useFetchRecentResources/onSuccess'),
          );
        },
      },
    );
  };

  useFetchRecentTopics = (isLogin: boolean | undefined): SWRResponse<RecentTopic[]> => {
    return useClientDataSWR<RecentTopic[]>(
      // Only fetch when login status is explicitly true (not null/undefined)
      isLogin === true ? [FETCH_RECENT_TOPICS_KEY, isLogin] : null,
      async () => topicService.getRecentTopics(12),
      {
        onSuccess: (data) => {
          if (this.#get().isRecentTopicsInit && isEqual(this.#get().recentTopics, data)) return;

          this.#set(
            { isRecentTopicsInit: true, recentTopics: data },
            false,
            n('useFetchRecentTopics/onSuccess'),
          );
        },
      },
    );
  };
}

export type RecentAction = Pick<RecentActionImpl, keyof RecentActionImpl>;

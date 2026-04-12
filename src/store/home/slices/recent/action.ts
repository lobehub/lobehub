import isEqual from 'fast-deep-equal';
import { type SWRResponse } from 'swr';

import { mutate, useClientDataSWRWithSync } from '@/libs/swr';
import { type RecentItem } from '@/server/routers/lambda/recent';
import { fileService } from '@/services/file';
import { recentService } from '@/services/recent';
import { topicService } from '@/services/topic';
import { type HomeStore } from '@/store/home/store';
import { type StoreSetter } from '@/store/types';
import { type FileListItem } from '@/types/files';
import { type RecentTopic } from '@/types/topic';
import { setNamespace } from '@/utils/storeDebug';

const n = setNamespace('recent');

const FETCH_RECENT_TOPICS_KEY = 'fetchRecentTopics';
const FETCH_RECENT_RESOURCES_KEY = 'fetchRecentResources';
const FETCH_RECENT_PAGES_KEY = 'fetchRecentPages';
const FETCH_RECENTS_KEY = 'fetchRecents';

type Setter = StoreSetter<HomeStore>;
export const createRecentSlice = (set: Setter, get: () => HomeStore, _api?: unknown) =>
  new RecentActionImpl(set, get, _api);

export class RecentActionImpl {
  readonly #get: () => HomeStore;
  readonly #set: Setter;

  constructor(set: Setter, get: () => HomeStore, _api?: unknown) {
    void _api;
    this.#set = set;
    this.#get = get;
  }

  closeAllRecentsDrawer = (): void => {
    this.#set({ allRecentsDrawerOpen: false }, false, n('closeAllRecentsDrawer'));
  };

  openAllRecentsDrawer = (): void => {
    this.#set({ allRecentsDrawerOpen: true }, false, n('openAllRecentsDrawer'));
  };

  updateRecentTitle = (id: string, title: string): void => {
    const recents = this.#get().recents.map((item) => (item.id === id ? { ...item, title } : item));
    this.#set({ recents }, false, n('updateRecentTitle'));
  };

  removeRecent = (id: string): void => {
    const recents = this.#get().recents.filter((item) => item.id !== id);
    this.#set({ recents }, false, n('removeRecent'));
  };

  refreshRecents = async (): Promise<void> => {
    await mutate((key: unknown) => Array.isArray(key) && key[0] === FETCH_RECENTS_KEY);
  };

  useFetchRecents = (
    isLogin: boolean | undefined,
    limit: number = 10,
  ): SWRResponse<RecentItem[]> => {
    return useClientDataSWRWithSync<RecentItem[]>(
      isLogin === true ? [FETCH_RECENTS_KEY, isLogin, limit] : null,
      async () => recentService.getAll(limit + 1),
      {
        onData: (data) => {
          if (this.#get().isRecentsInit && isEqual(this.#get().recents, data)) return;

          this.#set({ isRecentsInit: true, recents: data }, false, n('useFetchRecents/onData'));
        },
      },
    );
  };

  useFetchRecentPages = (isLogin: boolean | undefined): SWRResponse<any[]> => {
    return useClientDataSWRWithSync<any[]>(
      // Only fetch when login status is explicitly true (not null/undefined)
      isLogin === true ? [FETCH_RECENT_PAGES_KEY, isLogin] : null,
      async () => fileService.getRecentPages(12),
      {
        onData: (data) => {
          if (this.#get().isRecentPagesInit && isEqual(this.#get().recentPages, data)) return;

          this.#set(
            { isRecentPagesInit: true, recentPages: data },
            false,
            n('useFetchRecentPages/onData'),
          );
        },
      },
    );
  };

  useFetchRecentResources = (isLogin: boolean | undefined): SWRResponse<FileListItem[]> => {
    return useClientDataSWRWithSync<FileListItem[]>(
      // Only fetch when login status is explicitly true (not null/undefined)
      isLogin === true ? [FETCH_RECENT_RESOURCES_KEY, isLogin] : null,
      async () => fileService.getRecentFiles(12),
      {
        onData: (data) => {
          if (this.#get().isRecentResourcesInit && isEqual(this.#get().recentResources, data))
            return;

          this.#set(
            { isRecentResourcesInit: true, recentResources: data },
            false,
            n('useFetchRecentResources/onData'),
          );
        },
      },
    );
  };

  useFetchRecentTopics = (isLogin: boolean | undefined): SWRResponse<RecentTopic[]> => {
    return useClientDataSWRWithSync<RecentTopic[]>(
      // Only fetch when login status is explicitly true (not null/undefined)
      isLogin === true ? [FETCH_RECENT_TOPICS_KEY, isLogin] : null,
      async () => topicService.getRecentTopics(12),
      {
        onData: (data) => {
          if (this.#get().isRecentTopicsInit && isEqual(this.#get().recentTopics, data)) return;

          this.#set(
            { isRecentTopicsInit: true, recentTopics: data },
            false,
            n('useFetchRecentTopics/onData'),
          );
        },
      },
    );
  };
}

export type RecentAction = Pick<RecentActionImpl, keyof RecentActionImpl>;

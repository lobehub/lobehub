import isEqual from 'fast-deep-equal';
import { type SWRResponse } from 'swr';

import { mutate, useClientDataSWRWithSync } from '@/libs/swr';
import { entityDataKeys, recentKeys } from '@/libs/swr/keys';
import { getCacheScope } from '@/libs/swr/useCacheScope';
import { type RecentItem } from '@/server/routers/lambda/recent';
import { RECENT_SIDEBAR_TYPES, recentService } from '@/services/recent';
import { getEntityStoreState } from '@/store/entity';
import { type HomeStore } from '@/store/home/store';
import { type StoreSetter } from '@/store/types';
import { setNamespace } from '@/utils/storeDebug';

const n = setNamespace('recent');

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
    const current = this.#get().recents.find((item) => item.id === id);
    const recents = this.#get().recents.map((item) => (item.id === id ? { ...item, title } : item));
    this.#set({ recents }, false, n('updateRecentTitle'));
    if (current?.type === 'topic') {
      getEntityStoreState().updateTopicEntityTitle(getCacheScope(), id, title);
    }
  };

  refreshRecents = async (): Promise<void> => {
    await Promise.all([
      mutate((key: unknown) => Array.isArray(key) && key[0] === recentKeys.list.root),
      mutate((key: unknown) => Array.isArray(key) && key[0] === recentKeys.allDrawer.root),
      mutate((key: unknown) => Array.isArray(key) && key[0] === entityDataKeys.recentTopics.root),
    ]);
  };

  useFetchRecents = (
    isLogin: boolean | undefined,
    limit: number = 10,
    scope: string,
  ): SWRResponse<RecentItem[]> => {
    return useClientDataSWRWithSync<RecentItem[]>(
      isLogin === true ? recentKeys.list(isLogin, limit, scope) : null,
      async () => recentService.getAll(limit + 1, RECENT_SIDEBAR_TYPES),
      {
        onData: (data) => {
          if (getCacheScope() !== scope) return;

          const state = this.#get();

          if (state.isRecentsInit && state.recentsScope === scope && isEqual(state.recents, data)) {
            return;
          }

          this.#set(
            { isRecentsInit: true, recents: data, recentsScope: scope },
            false,
            n('useFetchRecents/onData'),
          );
        },
      },
    );
  };
}

export type RecentAction = Pick<RecentActionImpl, keyof RecentActionImpl>;

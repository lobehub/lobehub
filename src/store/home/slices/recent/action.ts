import isEqual from 'fast-deep-equal';
import { type SWRResponse } from 'swr';

import { mutate, useClientDataSWRWithSync } from '@/libs/swr';
import { recentKeys } from '@/libs/swr/keys';
import { getCacheScope } from '@/libs/swr/useCacheScope';
import { type RecentItem } from '@/server/routers/lambda/recent';
import { recentService } from '@/services/recent';
import { type HomeStore } from '@/store/home/store';
import { type StoreSetter } from '@/store/types';
import { setNamespace } from '@/utils/storeDebug';

const n = setNamespace('recent');

// Mirror the home Daily Brief / task detail polling cadence so users see new
// items, status transitions (incl. backlog/paused → running which the per-item
// task.detail poll never caught) without manual refresh. SWR pauses when the
// tab is backgrounded.
const RECENTS_REFRESH_INTERVAL = 10_000;

const updateRecentTitleInList = (id: string, title: string) => (items?: RecentItem[]) =>
  items?.map((item) => (item.id === id ? { ...item, title } : item));

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

    const updater = updateRecentTitleInList(id, title);
    void Promise.all([
      mutate((key: unknown) => Array.isArray(key) && key[0] === recentKeys.list.root, updater, {
        revalidate: false,
      }),
      mutate(
        (key: unknown) => Array.isArray(key) && key[0] === recentKeys.allDrawer.root,
        updater,
        { revalidate: false },
      ),
    ]);
  };

  refreshRecents = async (): Promise<void> => {
    await Promise.all([
      mutate((key: unknown) => Array.isArray(key) && key[0] === recentKeys.list.root),
      mutate((key: unknown) => Array.isArray(key) && key[0] === recentKeys.allDrawer.root),
    ]);
  };

  useFetchRecents = (
    isLogin: boolean | undefined,
    limit: number = 10,
    scope: string,
  ): SWRResponse<RecentItem[]> => {
    return useClientDataSWRWithSync<RecentItem[]>(
      isLogin === true ? recentKeys.list(isLogin, limit, scope) : null,
      async () => recentService.getAll(limit + 1),
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
        refreshInterval: RECENTS_REFRESH_INTERVAL,
      },
    );
  };
}

export type RecentAction = Pick<RecentActionImpl, keyof RecentActionImpl>;

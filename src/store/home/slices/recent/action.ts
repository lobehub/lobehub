import type { RecentItem } from '@lobechat/types';
import { useLayoutEffect } from 'react';
import type { SWRResponse } from 'swr';

import { mutate, useClientDataSWR } from '@/libs/swr';
import { recentKeys } from '@/libs/swr/keys';
import { getCacheScope } from '@/libs/swr/useCacheScope';
import { RECENT_SIDEBAR_TYPES, recentService } from '@/services/recent';
import type { HomeStore } from '@/store/home/store';
import type { StoreSetter } from '@/store/types';
import { setNamespace } from '@/utils/storeDebug';

import type { RecentEntityRef, RecentIndex } from './initialState';

const n = setNamespace('recent');

const toRef = (item: Pick<RecentItem, 'id' | 'type'>): RecentEntityRef => `${item.type}:${item.id}`;

const updateRecentTitleInList =
  (type: RecentItem['type'], id: string, title: string) => (items?: RecentItem[]) =>
    items?.map((item) => (item.type === type && item.id === id ? { ...item, title } : item));

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

  commitRecentTitle = (
    scope: string,
    type: RecentItem['type'],
    id: string,
    title: string,
  ): void => {
    const ref = `${type}:${id}` as RecentEntityRef;
    const state = this.#get();
    const item = state.recentEntitiesByScope[scope]?.[ref];
    if (!item) return;

    const entities = { ...state.recentEntitiesByScope[scope], [ref]: { ...item, title } };
    const optimisticTitles = { ...state.recentOptimisticTitlesByScope[scope] };
    delete optimisticTitles[ref];

    this.#set(
      {
        recentEntitiesByScope: { ...state.recentEntitiesByScope, [scope]: entities },
        recentOptimisticTitlesByScope: {
          ...state.recentOptimisticTitlesByScope,
          [scope]: optimisticTitles,
        },
      },
      false,
      n('commitRecentTitle'),
    );
    const updater = updateRecentTitleInList(type, id, title);
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

  ingestRecents = (scope: string, items: RecentItem[], limit: number, observedAt: number): void => {
    if (getCacheScope() !== scope) return;

    const state = this.#get();
    const currentIndex = state.recentIndexesByScope[scope];
    if (currentIndex && observedAt < currentIndex.observedAt) return;

    const incomingRefs = items.map(toRef);
    const refs =
      currentIndex && currentIndex.limit > limit
        ? [...incomingRefs, ...currentIndex.refs.slice(incomingRefs.length)]
        : incomingRefs;
    const index: RecentIndex = {
      limit: Math.max(limit, currentIndex?.limit || 0),
      observedAt,
      refs: [...new Set(refs)],
    };
    const entities = { ...state.recentEntitiesByScope[scope] };
    for (const item of items) entities[toRef(item)] = item;

    this.#set(
      {
        recentEntitiesByScope: { ...state.recentEntitiesByScope, [scope]: entities },
        recentIndexesByScope: { ...state.recentIndexesByScope, [scope]: index },
      },
      false,
      n('ingestRecents'),
    );
  };

  openAllRecentsDrawer = (): void => {
    this.#set({ allRecentsDrawerOpen: true }, false, n('openAllRecentsDrawer'));
  };

  refreshRecents = async (): Promise<void> => {
    await Promise.all([
      mutate((key: unknown) => Array.isArray(key) && key[0] === recentKeys.list.root),
      mutate((key: unknown) => Array.isArray(key) && key[0] === recentKeys.allDrawer.root),
    ]);
  };

  rollbackRecentTitle = (scope: string, type: RecentItem['type'], id: string): void => {
    const ref = `${type}:${id}` as RecentEntityRef;
    const state = this.#get();
    const optimisticTitles = { ...state.recentOptimisticTitlesByScope[scope] };
    delete optimisticTitles[ref];
    this.#set(
      {
        recentOptimisticTitlesByScope: {
          ...state.recentOptimisticTitlesByScope,
          [scope]: optimisticTitles,
        },
      },
      false,
      n('rollbackRecentTitle'),
    );
  };

  setRecentTitleOptimistic = (
    scope: string,
    type: RecentItem['type'],
    id: string,
    title: string,
  ): void => {
    const ref = `${type}:${id}` as RecentEntityRef;
    const state = this.#get();
    this.#set(
      {
        recentOptimisticTitlesByScope: {
          ...state.recentOptimisticTitlesByScope,
          [scope]: { ...state.recentOptimisticTitlesByScope[scope], [ref]: title },
        },
      },
      false,
      n('setRecentTitleOptimistic'),
    );
  };

  useFetchAllRecents = (open: boolean, scope: string): SWRResponse<RecentItem[]> => {
    const response = useClientDataSWR<RecentItem[]>(
      open ? recentKeys.allDrawer(open, scope) : null,
      () => recentService.getAll(50, RECENT_SIDEBAR_TYPES),
    );
    useLayoutEffect(() => {
      if (response.data) this.ingestRecents(scope, response.data, 50, Date.now());
    }, [response.data, scope]);
    return response;
  };

  useFetchRecents = (
    isLogin: boolean | undefined,
    limit: number = 10,
    scope: string,
  ): SWRResponse<RecentItem[]> => {
    const requestLimit = limit + 1;
    const response = useClientDataSWR<RecentItem[]>(
      isLogin === true ? recentKeys.list(isLogin, limit, scope) : null,
      () => recentService.getAll(requestLimit, RECENT_SIDEBAR_TYPES),
    );
    useLayoutEffect(() => {
      if (response.data) this.ingestRecents(scope, response.data, requestLimit, Date.now());
    }, [requestLimit, response.data, scope]);
    return response;
  };
}

export type RecentAction = Pick<RecentActionImpl, keyof RecentActionImpl>;

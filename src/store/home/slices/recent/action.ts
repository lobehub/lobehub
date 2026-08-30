import type { RecentItem } from '@lobechat/types';
import { useLayoutEffect } from 'react';
import type { SWRResponse } from 'swr';

import { mutate, useClientDataSWR } from '@/libs/swr';
import { recentKeys } from '@/libs/swr/keys';
import { getCacheScope } from '@/libs/swr/useCacheScope';
import { documentService } from '@/services/document';
import { RECENT_SIDEBAR_TYPES, recentService } from '@/services/recent';
import { taskService } from '@/services/task';
import { topicService } from '@/services/topic';
import type { HomeStore } from '@/store/home/store';
import type { StoreSetter } from '@/store/types';
import { setNamespace } from '@/utils/storeDebug';

import type { RecentEntityRef, RecentIndex, RecentScopeState } from './initialState';

const n = setNamespace('recent');

const toRef = (item: Pick<RecentItem, 'id' | 'type'>): RecentEntityRef => `${item.type}:${item.id}`;

const updateRecentTitleInList =
  (type: RecentItem['type'], id: string, title: string) => (items?: RecentItem[]) =>
    items?.map((item) => (item.type === type && item.id === id ? { ...item, title } : item));

const createScopeState = (): RecentScopeState => ({ entities: {}, optimisticTitles: {} });

const matchesScopedRecentKey = (key: unknown, root: string, scope: string) =>
  Array.isArray(key) && key[0] === root && key.at(-1) === scope;

interface RenameRecentParams {
  id: string;
  scope: string;
  title: string;
  type: RecentItem['type'];
}

type Setter = StoreSetter<HomeStore>;
export const createRecentSlice = (set: Setter, get: () => HomeStore, _api?: unknown) =>
  new RecentActionImpl(set, get, _api);

export class RecentActionImpl {
  readonly #get: () => HomeStore;
  readonly #renameQueues = new Map<string, Promise<void>>();
  readonly #set: Setter;
  #mutationId = 0;

  constructor(set: Setter, get: () => HomeStore, _api?: unknown) {
    void _api;
    this.#set = set;
    this.#get = get;
  }

  closeAllRecentsDrawer = (): void => {
    this.#set({ allRecentsDrawerOpen: false }, false, n('closeAllRecentsDrawer'));
  };

  #commitRecentTitle = (
    scope: string,
    type: RecentItem['type'],
    id: string,
    title: string,
    mutationId: number,
  ): void => {
    const ref = `${type}:${id}` as RecentEntityRef;
    const state = this.#get();
    const scopedState = state.recentsByScope[scope];
    const item = scopedState?.entities[ref];
    if (!item) return;

    const optimisticTitles = { ...scopedState.optimisticTitles };
    if (optimisticTitles[ref]?.mutationId === mutationId) delete optimisticTitles[ref];

    this.#set(
      {
        recentsByScope: {
          ...state.recentsByScope,
          [scope]: {
            ...scopedState,
            entities: { ...scopedState.entities, [ref]: { ...item, title } },
            optimisticTitles,
          },
        },
      },
      false,
      n('commitRecentTitle'),
    );
    const updater = updateRecentTitleInList(type, id, title);
    void Promise.all([
      mutate((key: unknown) => matchesScopedRecentKey(key, recentKeys.list.root, scope), updater, {
        revalidate: false,
      }),
      mutate(
        (key: unknown) => matchesScopedRecentKey(key, recentKeys.allDrawer.root, scope),
        updater,
        { revalidate: false },
      ),
    ]);
  };

  #persistRecentTitle = async ({ id, title, type }: RenameRecentParams): Promise<void> => {
    switch (type) {
      case 'document': {
        await documentService.updateDocument({ id, title });
        break;
      }
      case 'task': {
        await taskService.update(id, { name: title });
        break;
      }
      case 'topic': {
        await topicService.updateTopic(id, { title });
        break;
      }
    }
  };

  #rollbackRecentTitle = (
    scope: string,
    type: RecentItem['type'],
    id: string,
    mutationId: number,
  ): void => {
    const ref = `${type}:${id}` as RecentEntityRef;
    const state = this.#get();
    const scopedState = state.recentsByScope[scope];
    if (!scopedState || scopedState.optimisticTitles[ref]?.mutationId !== mutationId) return;

    const optimisticTitles = { ...scopedState.optimisticTitles };
    delete optimisticTitles[ref];
    this.#set(
      {
        recentsByScope: {
          ...state.recentsByScope,
          [scope]: { ...scopedState, optimisticTitles },
        },
      },
      false,
      n('rollbackRecentTitle'),
    );
  };

  #setRecentTitleOptimistic = (
    scope: string,
    type: RecentItem['type'],
    id: string,
    title: string,
    mutationId: number,
  ): void => {
    const ref = `${type}:${id}` as RecentEntityRef;
    const state = this.#get();
    const scopedState = state.recentsByScope[scope] ?? createScopeState();
    this.#set(
      {
        recentsByScope: {
          ...state.recentsByScope,
          [scope]: {
            ...scopedState,
            optimisticTitles: {
              ...scopedState.optimisticTitles,
              [ref]: { mutationId, title },
            },
          },
        },
      },
      false,
      n('setRecentTitleOptimistic'),
    );
  };

  ingestRecents = (scope: string, items: RecentItem[], limit: number, observedAt: number): void => {
    if (getCacheScope() !== scope) return;

    const state = this.#get();
    const scopedState = state.recentsByScope[scope] ?? createScopeState();
    const currentIndex = scopedState.index;
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
    const entities = { ...scopedState.entities };
    for (const item of items) entities[toRef(item)] = item;

    this.#set(
      {
        recentsByScope: {
          ...state.recentsByScope,
          [scope]: { ...scopedState, entities, index },
        },
      },
      false,
      n('ingestRecents'),
    );
  };

  openAllRecentsDrawer = (): void => {
    this.#set({ allRecentsDrawerOpen: true }, false, n('openAllRecentsDrawer'));
  };

  refreshRecents = async (scope: string): Promise<void> => {
    await Promise.all([
      mutate((key: unknown) => matchesScopedRecentKey(key, recentKeys.list.root, scope)),
      mutate((key: unknown) => matchesScopedRecentKey(key, recentKeys.allDrawer.root, scope)),
    ]);
  };

  renameRecent = async (params: RenameRecentParams): Promise<void> => {
    const { id, scope, title, type } = params;
    const ref = `${type}:${id}` as RecentEntityRef;
    const mutationId = ++this.#mutationId;
    const queueKey = `${scope}:${ref}`;
    this.#setRecentTitleOptimistic(scope, type, id, title, mutationId);

    const previous = this.#renameQueues.get(queueKey) ?? Promise.resolve();
    const operation = previous.catch(() => undefined).then(() => this.#persistRecentTitle(params));
    this.#renameQueues.set(queueKey, operation);

    try {
      await operation;
      this.#commitRecentTitle(scope, type, id, title, mutationId);
    } catch (error) {
      this.#rollbackRecentTitle(scope, type, id, mutationId);
      throw error;
    } finally {
      if (this.#renameQueues.get(queueKey) === operation) this.#renameQueues.delete(queueKey);
    }
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

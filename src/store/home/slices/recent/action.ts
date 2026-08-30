import type { RecentItem } from '@lobechat/types';
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

import { createRecentQueryKey, persistRecentQueries } from './initialState';
import type { RecentDispatchAction } from './reducer';
import { recentReducer } from './reducer';

const n = setNamespace('recent');

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

  internal_dispatchRecent = (action: RecentDispatchAction): void => {
    this.#set((state) => recentReducer(state, action), false, n(action.type));
  };

  internal_replaceRecentQuery = (scope: string, queryKey: string, items: RecentItem[]): void => {
    if (getCacheScope() !== scope) return;

    this.internal_dispatchRecent({
      items,
      queryKey,
      scope,
      type: 'replaceQuery',
      updatedAt: Date.now(),
    });
    persistRecentQueries(this.#get().recentsByScope);
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
    const mutationId = ++this.#mutationId;
    const queueKey = `${scope}:${type}:${id}`;
    this.internal_dispatchRecent({
      entityType: type,
      id,
      mutationId,
      scope,
      title,
      type: 'setOptimisticTitle',
    });

    const previous = this.#renameQueues.get(queueKey) ?? Promise.resolve();
    const operation = previous.catch(() => undefined).then(() => this.#persistRecentTitle(params));
    this.#renameQueues.set(queueKey, operation);

    try {
      await operation;
      this.internal_dispatchRecent({
        entityType: type,
        id,
        mutationId,
        scope,
        title,
        type: 'commitTitle',
      });
      persistRecentQueries(this.#get().recentsByScope);
    } catch (error) {
      this.internal_dispatchRecent({
        entityType: type,
        id,
        mutationId,
        scope,
        type: 'rollbackTitle',
      });
      throw error;
    } finally {
      if (this.#renameQueues.get(queueKey) === operation) this.#renameQueues.delete(queueKey);
    }
  };

  useFetchAllRecents = (open: boolean, scope: string): SWRResponse<number> => {
    const limit = 50;
    const queryKey = createRecentQueryKey(limit);
    return useClientDataSWR<number>(open ? recentKeys.allDrawer(open, scope) : null, async () => {
      const items = await recentService.getAll(limit, RECENT_SIDEBAR_TYPES);
      this.internal_replaceRecentQuery(scope, queryKey, items);
      return Date.now();
    });
  };

  useFetchRecents = (
    isLogin: boolean | undefined,
    scope: string,
    limit: number = 10,
  ): SWRResponse<number> => {
    const requestLimit = limit + 1;
    const queryKey = createRecentQueryKey(requestLimit);
    return useClientDataSWR<number>(
      isLogin === true ? recentKeys.list(isLogin, limit, scope) : null,
      async () => {
        const items = await recentService.getAll(requestLimit, RECENT_SIDEBAR_TYPES);
        this.internal_replaceRecentQuery(scope, queryKey, items);
        return Date.now();
      },
    );
  };
}

export type RecentAction = Pick<RecentActionImpl, keyof RecentActionImpl>;

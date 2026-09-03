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

import { createRecentQueryKey } from './initialState';
import { recentProjection } from './projection';
import type { RecentDispatchAction } from './reducer';
import { recentReducer } from './reducer';

const n = setNamespace('recent');
const RECENT_PROJECTION_KEY = 'home-recents-projection';

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
  readonly #hydrationPromises = new Map<string, Promise<void>>();
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

  #persistQuery = (scope: string, queryKey: string): void => {
    const query = this.#get().recentsByScope[scope]?.queries[queryKey];
    if (!query) return;

    void recentProjection
      .set({ queryKey, scope }, { data: query.items, updatedAt: query.updatedAt })
      .catch((error) => console.error('Failed to persist recent projection', error));
  };

  #persistScopeQueries = (scope: string): void => {
    const queries = this.#get().recentsByScope[scope]?.queries;
    if (!queries) return;
    for (const queryKey of Object.keys(queries)) this.#persistQuery(scope, queryKey);
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
    this.#persistQuery(scope, queryKey);
  };

  hydrateRecentQuery = async (scope: string, queryKey: string): Promise<void> => {
    const hydrationKey = `${scope}:${queryKey}`;
    const existing = this.#hydrationPromises.get(hydrationKey);
    if (existing) return existing;

    const hydration = (async () => {
      this.internal_dispatchRecent({ queryKey, scope, type: 'startHydration' });

      try {
        const projection = await recentProjection.get({ queryKey, scope });
        if (getCacheScope() !== scope) return;

        if (projection) {
          this.internal_dispatchRecent({
            items: projection.data,
            queryKey,
            scope,
            type: 'hydrateQuery',
            updatedAt: projection.updatedAt,
          });
        } else {
          this.internal_dispatchRecent({ queryKey, scope, type: 'finishHydration' });
        }
      } catch (error) {
        console.error('Failed to hydrate recent projection', error);
        this.internal_dispatchRecent({ queryKey, scope, type: 'failHydration' });
      }
    })();

    this.#hydrationPromises.set(hydrationKey, hydration);
    try {
      await hydration;
    } finally {
      this.#hydrationPromises.delete(hydrationKey);
    }
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
      this.#persistScopeQueries(scope);
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
    useClientDataSWR<number>(open ? [RECENT_PROJECTION_KEY, scope, queryKey] : null, async () => {
      await this.hydrateRecentQuery(scope, queryKey);
      return Date.now();
    });

    return useClientDataSWR<number>(open ? recentKeys.allDrawer(open, scope) : null, async () => {
      this.internal_dispatchRecent({ queryKey, scope, type: 'startSync' });

      try {
        const items = await recentService.getAll(limit, RECENT_SIDEBAR_TYPES);
        this.internal_replaceRecentQuery(scope, queryKey, items);
        this.internal_dispatchRecent({ queryKey, scope, type: 'finishSync' });
        return Date.now();
      } catch (error) {
        this.internal_dispatchRecent({ error, queryKey, scope, type: 'failSync' });
        throw error;
      }
    });
  };

  useFetchRecents = (
    isLogin: boolean | undefined,
    scope: string,
    limit: number = 10,
  ): SWRResponse<number> => {
    const requestLimit = limit + 1;
    const queryKey = createRecentQueryKey(requestLimit);
    useClientDataSWR<number>(
      isLogin === true ? [RECENT_PROJECTION_KEY, scope, queryKey] : null,
      async () => {
        await this.hydrateRecentQuery(scope, queryKey);
        return Date.now();
      },
    );

    return useClientDataSWR<number>(
      isLogin === true ? recentKeys.list(isLogin, limit, scope) : null,
      async () => {
        this.internal_dispatchRecent({ queryKey, scope, type: 'startSync' });

        try {
          const items = await recentService.getAll(requestLimit, RECENT_SIDEBAR_TYPES);
          this.internal_replaceRecentQuery(scope, queryKey, items);
          this.internal_dispatchRecent({ queryKey, scope, type: 'finishSync' });
          return Date.now();
        } catch (error) {
          this.internal_dispatchRecent({ error, queryKey, scope, type: 'failSync' });
          throw error;
        }
      },
    );
  };
}

export type RecentAction = Pick<RecentActionImpl, keyof RecentActionImpl>;

import type {
  TrashCountByType,
  TrashItem,
  TrashListResult,
  TrashResourceType,
} from '@lobechat/types';
import type { SWRResponse } from 'swr';

import { mutate, useClientDataSWR } from '@/libs/swr';
import { trashKeys } from '@/libs/swr/keys';
import { trashService } from '@/services/trash';
import type { StoreSetter } from '@/store/types';

import type { TrashStore } from './store';

type Setter = StoreSetter<TrashStore>;

/** SWR key roots whose lists can regain rows after a restore. */
const RESTORE_AFFECTED_KEY_PREFIXES = [
  'document:',
  'file:',
  'home:',
  'image:',
  'knowledgeBase:',
  'page',
  'recent:',
  'resource:',
  'video:',
];

export const trashSlice = (set: Setter, get: () => TrashStore, _api?: unknown) =>
  new TrashActionImpl(set, get, _api);

/**
 * Recycle-bin store. Rows are removed optimistically on restore / purge and
 * the list + counts are revalidated afterwards so a failed call self-corrects.
 */
export class TrashActionImpl {
  #activeResourceType?: TrashResourceType;
  #activeScopeId: string | null = null;
  readonly #get: () => TrashStore;
  readonly #set: Setter;

  constructor(set: Setter, get: () => TrashStore, _api?: unknown) {
    void _api;
    this.#set = set;
    this.#get = get;
  }

  setActiveType = (activeType?: TrashResourceType) => {
    this.#activeResourceType = activeType;
    this.#set(
      { activeType, isTrashInit: false, items: [], nextCursor: null },
      false,
      'setActiveType',
    );
  };

  refresh = async () => {
    const results = await Promise.allSettled([
      mutate(trashKeys.list(this.#activeScopeId, this.#get().activeType)),
      mutate(trashKeys.countByType(this.#activeScopeId)),
    ]);
    for (const result of results) {
      if (result.status === 'rejected') console.error('[trash:refresh]', result.reason);
    }
  };

  /**
   * A restore brings rows back into Resource lists owned by other stores.
   * Revalidate every mounted SWR key in
   * those namespaces so a user returning from the recycle bin sees the restored
   * file, document, folder, or knowledge base without a reload. `mutate` with a
   * filter only re-fetches keys that have a mounted subscriber, so this is cheap.
   */
  revalidateRestoredScopes = async () => {
    try {
      await mutate(
        (key: unknown) =>
          Array.isArray(key) &&
          typeof key[0] === 'string' &&
          RESTORE_AFFECTED_KEY_PREFIXES.some((prefix) => (key[0] as string).startsWith(prefix)),
      );
    } catch (error) {
      console.error('[trash:revalidateRestoredScopes]', error);
    }
  };

  loadMore = async () => {
    const { activeType, itemsScopeId, nextCursor } = this.#get();
    if (!nextCursor) return;
    const requestResourceType = activeType;
    const requestScopeId = this.#activeScopeId;
    if (itemsScopeId !== requestScopeId) return;
    const page = await trashService.list({ cursor: nextCursor, resourceType: activeType });
    const state = this.#get();
    if (
      this.#activeScopeId !== requestScopeId ||
      this.#activeResourceType !== requestResourceType ||
      state.activeType !== requestResourceType ||
      state.itemsScopeId !== requestScopeId ||
      state.nextCursor !== nextCursor
    )
      return;
    this.#set(
      { items: [...state.items, ...page.items], nextCursor: page.nextCursor },
      false,
      'loadMore',
    );
  };

  #withLoading = async (ids: string[], run: () => Promise<void>) => {
    this.#set({ loadingIds: [...this.#get().loadingIds, ...ids] }, false, 'loading/start');
    try {
      await run();
    } finally {
      const done = new Set(ids);
      this.#set(
        { loadingIds: this.#get().loadingIds.filter((id) => !done.has(id)) },
        false,
        'loading/end',
      );
      await this.refresh();
    }
  };

  /**
   * Restore roots. Returns the server outcome so the caller can toast the
   * partial failures (for example, a document whose parent folder is still in
   * the bin). Only the successfully restored rows leave the list.
   */
  restore = async (ids: string[]) => {
    let outcome: Awaited<ReturnType<typeof trashService.restore>> = { failed: [], restored: [] };
    await this.#withLoading(ids, async () => {
      outcome = await trashService.restore(ids);
      const gone = new Set(outcome.restored.map((item) => item.id));
      // `notFound` rows were dropped from the registry server-side.
      for (const failure of outcome.failed) if (failure.code === 'notFound') gone.add(failure.id);
      this.#set(
        { items: this.#get().items.filter((item) => !gone.has(item.id)) },
        false,
        'restore',
      );
    });
    if (outcome.restored.length > 0) void this.revalidateRestoredScopes();
    return outcome;
  };

  purge = async (ids: string[]) => {
    let outcome: Awaited<ReturnType<typeof trashService.purge>> = {
      failed: [],
      purged: 0,
      purgedIds: [],
    };
    await this.#withLoading(ids, async () => {
      outcome = await trashService.purge(ids);
      const gone = new Set(outcome.purgedIds);
      this.#set({ items: this.#get().items.filter((item) => !gone.has(item.id)) }, false, 'purge');
    });
    return outcome;
  };

  emptyTrash = async () => {
    const { activeType, items } = this.#get();
    await this.#withLoading(
      items.map((item) => item.id),
      async () => {
        await trashService.emptyTrash(activeType);
        this.#set({ items: [], nextCursor: null }, false, 'emptyTrash');
      },
    );
  };

  useFetchTrash = (
    enabled: boolean,
    resourceType?: TrashResourceType,
    scopeId: string | null = null,
  ): SWRResponse<TrashListResult> => {
    this.#activeScopeId = scopeId;
    this.#activeResourceType = resourceType;
    return useClientDataSWR<TrashListResult>(
      enabled ? trashKeys.list(scopeId, resourceType) : null,
      () => trashService.list({ resourceType }),
      {
        onSuccess: (data) => {
          if (
            this.#activeScopeId !== scopeId ||
            this.#activeResourceType !== resourceType ||
            this.#get().activeType !== resourceType
          )
            return;
          this.#set(
            {
              isTrashInit: true,
              items: data.items,
              itemsScopeId: scopeId,
              nextCursor: data.nextCursor,
            },
            false,
            'fetchTrash',
          );
        },
      },
    );
  };

  useFetchTrashCount = (
    enabled: boolean,
    scopeId: string | null = null,
  ): SWRResponse<TrashCountByType> => {
    this.#activeScopeId = scopeId;
    return useClientDataSWR<TrashCountByType>(
      enabled ? trashKeys.countByType(scopeId) : null,
      () => trashService.countByType(),
      {
        onSuccess: (data) => {
          if (this.#activeScopeId !== scopeId) return;
          this.#set({ countByType: data, countScopeId: scopeId }, false, 'fetchTrashCount');
        },
      },
    );
  };
}

export type TrashAction = Pick<TrashActionImpl, keyof TrashActionImpl>;
export type { TrashItem };

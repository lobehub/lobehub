import type {
  TrashCountByType,
  TrashItem,
  TrashListResult,
  TrashResourceType,
} from '@lobechat/types';
import { useLayoutEffect } from 'react';
import type { SWRResponse } from 'swr';

import { mutate, useClientDataSWR } from '@/libs/swr';
import { trashKeys } from '@/libs/swr/keys';
import { getCacheScope, useCacheScope } from '@/libs/swr/useCacheScope';
import { trashService } from '@/services/trash';
import type { StoreSetter } from '@/store/types';

import type { TrashStore } from './store';

type Setter = StoreSetter<TrashStore>;

/** SWR key roots whose lists can regain rows after a restore. */
const RESTORE_AFFECTED_KEY_PREFIXES = [
  'agent:',
  // Agent sidebar sync keys (#18913) live outside `agent:` so they skip SWR persistence.
  'agentSync:',
  'document:',
  'file:',
  'group:',
  'home:',
  'image:',
  'knowledgeBase:',
  // Replicas (topic list, …) sync through `replica:sync` keys (`@lobechat/replica`).
  'replica:',
  'page',
  'project',
  'recent:',
  'resource:',
  'session:',
  'task:',
  'topic:',
  'video:',
];

export const trashSlice = (set: Setter, get: () => TrashStore, _api?: unknown) =>
  new TrashActionImpl(set, get, _api);

/**
 * Recycle-bin store. Rows are removed optimistically on restore / purge and
 * the list + counts are revalidated afterwards so a failed call self-corrects.
 */
export class TrashActionImpl {
  readonly #get: () => TrashStore;
  readonly #set: Setter;

  constructor(set: Setter, get: () => TrashStore, _api?: unknown) {
    void _api;
    this.#set = set;
    this.#get = get;
  }

  setActiveType = (activeType?: TrashResourceType) => {
    this.#set(
      { activeType, isTrashInit: false, items: [], nextCursor: null },
      false,
      'setActiveType',
    );
  };

  refresh = async () => {
    await Promise.all([
      mutate(trashKeys.list(this.#get().activeType)),
      mutate(trashKeys.countByType()),
    ]);
  };

  /**
   * A restore brings rows back into lists owned by other stores (sidebar
   * agents, topics, pages, files, tasks …). Revalidate every mounted SWR key in
   * those namespaces so a user returning from the recycle bin sees the row
   * without a reload. `mutate` with a filter only re-fetches keys that have a
   * mounted subscriber, so this is cheap.
   */
  revalidateRestoredScopes = async () => {
    await mutate(
      (key: unknown) =>
        Array.isArray(key) &&
        typeof key[0] === 'string' &&
        RESTORE_AFFECTED_KEY_PREFIXES.some((prefix) => (key[0] as string).startsWith(prefix)),
    );
  };

  loadMore = async () => {
    const { activeType, isLoadingMore, nextCursor, scope } = this.#get();
    if (!nextCursor || isLoadingMore) return;
    this.#set({ isLoadingMore: true }, false, 'loadMore/start');
    try {
      const page = await trashService.list({ cursor: nextCursor, resourceType: activeType });
      // The filter, cursor or workspace may have moved on while this page was
      // in flight; appending it then would mix another list's rows in.
      const current = this.#get();
      if (
        current.activeType !== activeType ||
        current.nextCursor !== nextCursor ||
        current.scope !== scope
      )
        return;
      this.#set(
        { items: [...current.items, ...page.items], nextCursor: page.nextCursor },
        false,
        'loadMore',
      );
    } finally {
      this.#set({ isLoadingMore: false }, false, 'loadMore/end');
    }
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
   * partial failures (a topic whose agent is still in the bin, …). Only the
   * successfully restored rows leave the list.
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
    await this.#withLoading(ids, async () => {
      await trashService.purge(ids);
      const gone = new Set(ids);
      this.#set({ items: this.#get().items.filter((item) => !gone.has(item.id)) }, false, 'purge');
    });
  };

  emptyTrash = async () => {
    const { activeType, items } = this.#get();
    await this.#withLoading(
      items.map((item) => item.id),
      async () => {
        // The server purges one bounded batch per call so no single request
        // runs away on a large bin; keep going until it reports nothing left.
        for (;;) {
          const { hasMore } = await trashService.emptyTrash(activeType);
          if (!hasMore) break;
        }
        this.#set({ items: [], nextCursor: null }, false, 'emptyTrash');
      },
    );
  };

  useFetchTrash = (
    enabled: boolean,
    resourceType?: TrashResourceType,
  ): SWRResponse<TrashListResult> => {
    const scope = useCacheScope();

    // A workspace (or user) switch inside the SPA: drop the previous scope's
    // rows before paint instead of showing them until — or, if the fetch
    // fails, instead of — the new scope's list.
    useLayoutEffect(() => {
      if (!enabled || this.#get().scope === scope) return;
      this.#set(
        { countByType: {}, isTrashInit: false, items: [], nextCursor: null, scope },
        false,
        'fetchTrash/scope',
      );
    }, [enabled, scope]);

    return useClientDataSWR<TrashListResult>(
      enabled ? trashKeys.list(resourceType) : null,
      () => trashService.list({ resourceType }),
      {
        onSuccess: (data) => {
          if (scope !== getCacheScope()) return;
          this.#set(
            { isTrashInit: true, items: data.items, nextCursor: data.nextCursor, scope },
            false,
            'fetchTrash',
          );
        },
      },
    );
  };

  useFetchTrashCount = (enabled: boolean): SWRResponse<TrashCountByType> => {
    const scope = useCacheScope();
    return useClientDataSWR<TrashCountByType>(
      enabled ? trashKeys.countByType() : null,
      () => trashService.countByType(),
      {
        onSuccess: (data) => {
          if (scope !== getCacheScope()) return;
          this.#set({ countByType: data }, false, 'fetchTrashCount');
        },
      },
    );
  };
}

export type TrashAction = Pick<TrashActionImpl, keyof TrashActionImpl>;
export type { TrashItem };

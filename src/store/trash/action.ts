import type {
  TrashCountByType,
  TrashItem,
  TrashListResult,
  TrashResourceType,
} from '@lobechat/types';
import type { SWRResponse } from 'swr';
import type { StateCreator } from 'zustand/vanilla';

import type { trashService as trashServiceInstance } from '@/services/trash';

import { mutateTrash, useTrashDataSWR } from './hooks';
import { trashKeys } from './keys';
import type { TrashStore } from './store';

type TrashService = typeof trashServiceInstance;
type EmptyTrashOutcome = Awaited<ReturnType<TrashService['emptyTrash']>>;
type PurgeOutcome = Awaited<ReturnType<TrashService['purge']>>;
type RestoreOutcome = Awaited<ReturnType<TrashService['restore']>>;
type TrashSlice = StateCreator<TrashStore, [['zustand/devtools', never]], [], TrashAction>;

const getTrashService = async () => (await import('@/services/trash')).trashService;

/** SWR key roots whose lists can regain rows after a restore. */
const RESTORE_AFFECTED_KEY_PREFIXES = [
  'agent:document',
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

/**
 * Recycle-bin store. Rows are removed optimistically on restore / purge and
 * the list + counts are revalidated afterwards so a failed call self-corrects.
 */
export const trashSlice: TrashSlice = (set, get) => {
  let activeResourceType: TrashResourceType | undefined;
  let activeScopeId: string | null = null;

  const refresh = async () => {
    const results = await Promise.allSettled([
      mutateTrash(trashKeys.list(activeScopeId, get().activeType)),
      mutateTrash(trashKeys.countByType(activeScopeId)),
    ]);
    for (const result of results) {
      if (result.status === 'rejected') console.error('[trash:refresh]', result.reason);
    }
  };

  const withLoading = async (ids: string[], run: () => Promise<void>) => {
    set({ loadingIds: [...get().loadingIds, ...ids] }, false, 'loading/start');
    try {
      await run();
    } finally {
      const done = new Set(ids);
      set({ loadingIds: get().loadingIds.filter((id) => !done.has(id)) }, false, 'loading/end');
      await refresh();
    }
  };

  const revalidateRestoredScopes = async () => {
    try {
      await mutateTrash(
        (key: unknown) =>
          Array.isArray(key) &&
          typeof key[0] === 'string' &&
          RESTORE_AFFECTED_KEY_PREFIXES.some((prefix) => (key[0] as string).startsWith(prefix)),
      );
    } catch (error) {
      console.error('[trash:revalidateRestoredScopes]', error);
    }
  };

  return {
    setActiveType: (activeType?: TrashResourceType) => {
      activeResourceType = activeType;
      set({ activeType, isTrashInit: false, items: [], nextCursor: null }, false, 'setActiveType');
    },
    refresh,
    revalidateRestoredScopes,
    loadMore: async () => {
      const { activeType, itemsScopeId, nextCursor } = get();
      if (!nextCursor) return;
      const requestResourceType = activeType;
      const requestScopeId = activeScopeId;
      if (itemsScopeId !== requestScopeId) return;
      const trashService = await getTrashService();
      const page = await trashService.list({ cursor: nextCursor, resourceType: activeType });
      const state = get();
      if (
        activeScopeId !== requestScopeId ||
        activeResourceType !== requestResourceType ||
        state.activeType !== requestResourceType ||
        state.itemsScopeId !== requestScopeId ||
        state.nextCursor !== nextCursor
      )
        return;
      set(
        { items: [...state.items, ...page.items], nextCursor: page.nextCursor },
        false,
        'loadMore',
      );
    },
    restore: async (ids: string[]) => {
      let outcome: RestoreOutcome = { failed: [], restored: [] };
      await withLoading(ids, async () => {
        const trashService = await getTrashService();
        outcome = await trashService.restore(ids);
        const gone = new Set(outcome.restored.map((item) => item.id));
        for (const failure of outcome.failed) if (failure.code === 'notFound') gone.add(failure.id);
        set({ items: get().items.filter((item) => !gone.has(item.id)) }, false, 'restore');
      });
      if (outcome.restored.length > 0) void revalidateRestoredScopes();
      return outcome;
    },
    purge: async (ids: string[]) => {
      let outcome: PurgeOutcome = {
        failed: [],
        purged: 0,
        purgedIds: [],
      };
      await withLoading(ids, async () => {
        const trashService = await getTrashService();
        outcome = await trashService.purge(ids);
        const gone = new Set(outcome.purgedIds);
        set({ items: get().items.filter((item) => !gone.has(item.id)) }, false, 'purge');
      });
      return outcome;
    },
    emptyTrash: async () => {
      const { activeType, items } = get();
      let outcome: EmptyTrashOutcome = { scheduled: 0 };
      await withLoading(
        items.map((item) => item.id),
        async () => {
          const trashService = await getTrashService();
          outcome = await trashService.emptyTrash(activeType);
          set({ items: [], nextCursor: null }, false, 'emptyTrash');
        },
      );
      return outcome;
    },
    useFetchTrash: (
      enabled: boolean,
      resourceType?: TrashResourceType,
      scopeId: string | null = null,
    ): SWRResponse<TrashListResult> => {
      activeScopeId = scopeId;
      activeResourceType = resourceType;
      return useTrashDataSWR<TrashListResult>(
        enabled ? trashKeys.list(scopeId, resourceType) : null,
        async () => (await getTrashService()).list({ resourceType }),
        {
          onSuccess: (data) => {
            if (
              activeScopeId !== scopeId ||
              activeResourceType !== resourceType ||
              get().activeType !== resourceType
            )
              return;
            set(
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
    },
    useFetchTrashCount: (
      enabled: boolean,
      scopeId: string | null = null,
    ): SWRResponse<TrashCountByType> => {
      activeScopeId = scopeId;
      return useTrashDataSWR<TrashCountByType>(
        enabled ? trashKeys.countByType(scopeId) : null,
        async () => (await getTrashService()).countByType(),
        {
          onSuccess: (data) => {
            if (activeScopeId !== scopeId) return;
            set({ countByType: data, countScopeId: scopeId }, false, 'fetchTrashCount');
          },
        },
      );
    },
  };
};

export interface TrashAction {
  emptyTrash: () => Promise<EmptyTrashOutcome>;
  loadMore: () => Promise<void>;
  purge: (ids: string[]) => Promise<PurgeOutcome>;
  refresh: () => Promise<void>;
  restore: (ids: string[]) => Promise<RestoreOutcome>;
  revalidateRestoredScopes: () => Promise<void>;
  setActiveType: (activeType?: TrashResourceType) => void;
  useFetchTrash: (
    enabled: boolean,
    resourceType?: TrashResourceType,
    scopeId?: string | null,
  ) => SWRResponse<TrashListResult>;
  useFetchTrashCount: (enabled: boolean, scopeId?: string | null) => SWRResponse<TrashCountByType>;
}

export type { TrashItem };

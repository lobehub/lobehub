import type {
  ResourceTrashCountByType,
  ResourceTrashItem,
  ResourceTrashListResult,
  ResourceTrashType,
} from '@lobechat/types';
import type { SWRResponse } from 'swr';
import type { StateCreator } from 'zustand/vanilla';

import type { trashService as trashServiceInstance } from '@/services/trash';

import { mutateTrash, useTrashDataSWR } from './hooks';
import { trashBucketKey, trashKeys, trashScopeKey } from './keys';
import type { TrashStore } from './store';

type TrashService = typeof trashServiceInstance;
type EmptyTrashOutcome = Awaited<ReturnType<TrashService['emptyTrash']>>;
type PurgeOutcome = Awaited<ReturnType<TrashService['purge']>>;
type RestoreOutcome = Awaited<ReturnType<TrashService['restore']>>;
type TrashSlice = StateCreator<TrashStore, [['zustand/devtools', never]], [], TrashAction>;

export interface TrashBucketContext {
  resourceType?: ResourceTrashType;
  scopeId: string | null;
}

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
 * Recycle-bin store. Server data is bucketed by workspace + filter so two
 * concurrently mounted settings surfaces never overwrite each other's rows.
 */
export const trashSlice: TrashSlice = (set, get) => {
  const refresh = async ({ scopeId }: TrashBucketContext) => {
    const scopeKey = trashScopeKey(scopeId);
    const results = await Promise.allSettled([
      mutateTrash(
        (key: unknown) => Array.isArray(key) && key[0] === 'trash:list' && key[1] === scopeKey,
      ),
      mutateTrash(trashKeys.countByType(scopeId)),
    ]);
    for (const result of results) {
      if (result.status === 'rejected') console.error('[trash:refresh]', result.reason);
    }
  };

  const withLoading = async (
    ids: string[],
    context: TrashBucketContext,
    run: () => Promise<void>,
  ) => {
    set({ loadingIds: [...get().loadingIds, ...ids] }, false, 'loading/start');
    try {
      await run();
    } finally {
      const done = new Set(ids);
      set({ loadingIds: get().loadingIds.filter((id) => !done.has(id)) }, false, 'loading/end');
      await refresh(context);
    }
  };

  const updateBucketItems = (
    context: TrashBucketContext,
    updater: (items: ResourceTrashItem[]) => ResourceTrashItem[],
    action: string,
  ) => {
    const bucketKey = trashBucketKey(context.scopeId, context.resourceType);
    const bucket = get().listByBucket[bucketKey];
    if (!bucket) return;
    set(
      {
        listByBucket: {
          ...get().listByBucket,
          [bucketKey]: { ...bucket, items: updater(bucket.items) },
        },
      },
      false,
      action,
    );
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
    refresh,
    revalidateRestoredScopes,
    loadMore: async (context: TrashBucketContext) => {
      const bucketKey = trashBucketKey(context.scopeId, context.resourceType);
      const bucket = get().listByBucket[bucketKey];
      if (!bucket?.nextCursor) return;
      const requestCursor = bucket.nextCursor;
      const trashService = await getTrashService();
      const page = await trashService.list({
        cursor: requestCursor,
        resourceType: context.resourceType,
      });
      const currentBucket = get().listByBucket[bucketKey];
      if (currentBucket?.nextCursor !== requestCursor) return;
      set(
        {
          listByBucket: {
            ...get().listByBucket,
            [bucketKey]: {
              ...currentBucket,
              items: [...currentBucket.items, ...page.items],
              nextCursor: page.nextCursor,
            },
          },
        },
        false,
        'loadMore',
      );
    },
    restore: async (ids: string[], context: TrashBucketContext) => {
      let outcome: RestoreOutcome = { failed: [], restored: [] };
      await withLoading(ids, context, async () => {
        const trashService = await getTrashService();
        outcome = await trashService.restore(ids);
        const gone = new Set(outcome.restored.map((item) => item.id));
        for (const failure of outcome.failed) if (failure.code === 'notFound') gone.add(failure.id);
        updateBucketItems(
          context,
          (items) => items.filter((item) => !gone.has(item.id)),
          'restore',
        );
      });
      if (outcome.restored.length > 0) void revalidateRestoredScopes();
      return outcome;
    },
    purge: async (ids: string[], context: TrashBucketContext) => {
      let outcome: PurgeOutcome = { failed: [], purged: 0, purgedIds: [] };
      await withLoading(ids, context, async () => {
        const trashService = await getTrashService();
        outcome = await trashService.purge(ids);
        const gone = new Set(outcome.purgedIds);
        updateBucketItems(context, (items) => items.filter((item) => !gone.has(item.id)), 'purge');
      });
      return outcome;
    },
    emptyTrash: async (context: TrashBucketContext) => {
      const bucketKey = trashBucketKey(context.scopeId, context.resourceType);
      const items = get().listByBucket[bucketKey]?.items ?? [];
      let outcome: EmptyTrashOutcome = { scheduled: 0 };
      await withLoading(
        items.map((item) => item.id),
        context,
        async () => {
          const trashService = await getTrashService();
          outcome = await trashService.emptyTrash(context.resourceType);
          const bucket = get().listByBucket[bucketKey];
          if (!bucket) return;
          set(
            {
              listByBucket: {
                ...get().listByBucket,
                [bucketKey]: { ...bucket, items: [], nextCursor: null },
              },
            },
            false,
            'emptyTrash',
          );
        },
      );
      return outcome;
    },
    useFetchTrash: (
      enabled: boolean,
      resourceType?: ResourceTrashType,
      scopeId: string | null = null,
    ): SWRResponse<ResourceTrashListResult> => {
      const bucketKey = trashBucketKey(scopeId, resourceType);
      return useTrashDataSWR<ResourceTrashListResult>(
        enabled ? trashKeys.list(scopeId, resourceType) : null,
        async () => (await getTrashService()).list({ resourceType }),
        {
          onSuccess: (data) => {
            set(
              {
                listByBucket: {
                  ...get().listByBucket,
                  [bucketKey]: {
                    isTrashInit: true,
                    items: data.items,
                    nextCursor: data.nextCursor,
                  },
                },
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
    ): SWRResponse<ResourceTrashCountByType> => {
      const scopeKey = trashScopeKey(scopeId);
      return useTrashDataSWR<ResourceTrashCountByType>(
        enabled ? trashKeys.countByType(scopeId) : null,
        async () => (await getTrashService()).countByType(),
        {
          onSuccess: (data) => {
            set(
              { countByScope: { ...get().countByScope, [scopeKey]: data } },
              false,
              'fetchTrashCount',
            );
          },
        },
      );
    },
  };
};

export interface TrashAction {
  emptyTrash: (context: TrashBucketContext) => Promise<EmptyTrashOutcome>;
  loadMore: (context: TrashBucketContext) => Promise<void>;
  purge: (ids: string[], context: TrashBucketContext) => Promise<PurgeOutcome>;
  refresh: (context: TrashBucketContext) => Promise<void>;
  restore: (ids: string[], context: TrashBucketContext) => Promise<RestoreOutcome>;
  revalidateRestoredScopes: () => Promise<void>;
  useFetchTrash: (
    enabled: boolean,
    resourceType?: ResourceTrashType,
    scopeId?: string | null,
  ) => SWRResponse<ResourceTrashListResult>;
  useFetchTrashCount: (
    enabled: boolean,
    scopeId?: string | null,
  ) => SWRResponse<ResourceTrashCountByType>;
}

export type { ResourceTrashItem };

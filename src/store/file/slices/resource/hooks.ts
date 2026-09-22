import { isEqual } from 'es-toolkit';
import { useEffect } from 'react';
import { shallow } from 'zustand/shallow';

import {
  getActiveWorkspaceId,
  useActiveWorkspaceId,
} from '@/business/client/hooks/useActiveWorkspaceId';
import { mutate, useClientDataSWR } from '@/libs/swr';
import { resourceKeys } from '@/libs/swr/keys';
import { resourceService } from '@/services/resource';
import type { ResourceItem, ResourceQueryParams } from '@/types/resource';

import { useFileStore } from '../../store';
import { mergeServerResourcesWithOptimistic } from './utils';

type ResourceSWRKey = [string, ResourceQueryParams, string | null];

const isResourceSWRKey = (
  key: unknown,
  queryParams: ResourceQueryParams,
  workspaceId: string | null,
) => {
  if (!Array.isArray(key)) return false;

  return (
    key[0] === resourceKeys.list.root && isEqual(key[1], queryParams) && key[2] === workspaceId
  );
};

/**
 * Revalidate resources with current or specific query params
 * This can be called from outside React components (e.g., store actions)
 */
export const revalidateResources = async (params?: ResourceQueryParams) => {
  const queryParams = params || useFileStore.getState().queryParams;
  const workspaceId = getActiveWorkspaceId();
  if (queryParams) {
    await mutate(
      (key) => isResourceSWRKey(key, queryParams, workspaceId),
      async (currentData) => currentData,
      {
        revalidate: true,
      },
    );
  }
};

type ResourceListData = { hasMore: boolean; items: ResourceItem[]; total?: number };

/** Parent identifiers for one folder: its id, its slug, or `null` for the root. */
export type ResourceParentKey = string | null;

export interface ResourceMoveCachePatch {
  /** Every key the source folder may be addressed by in `queryParams.parentId`. */
  fromParentKeys: ResourceParentKey[];
  /** Every key the destination folder may be addressed by in `queryParams.parentId`. */
  toParentKeys: ResourceParentKey[];
}

const isResourceListKeyForParent = (
  key: unknown,
  workspaceId: string | null,
  libraryId: string | undefined,
  parentKeys: Set<ResourceParentKey>,
) => {
  if (!Array.isArray(key)) return false;
  if (key[0] !== resourceKeys.list.root || key[2] !== workspaceId) return false;

  const params = key[1] as ResourceQueryParams | undefined;
  if (!params || params.libraryId !== libraryId) return false;

  return parentKeys.has(params.parentId ?? null);
};

const stripOptimistic = (resource: ResourceItem): ResourceItem => {
  const { _optimistic, ...rest } = resource;
  void _optimistic;
  return rest;
};

/**
 * Keep every cached folder list in step with a move.
 *
 * `moveResource` only touches the mounted explorer state and the sidebar tree;
 * the SWR entries of the destination and source folders keep their old rows.
 * `useFetchResources` serves those entries synchronously on the next visit and
 * dedupes refetches for 30s, so the moved row was missing from the destination
 * (and could resurface in the source) until a focus revalidation. Patch the
 * cache entries themselves so the cache-hit path already shows the move.
 *
 * The patches are written with `revalidate: false` and the reconciling refetch
 * of any mounted key is fired without being awaited: SWR's `mutate` resolves
 * only after that refetch when `revalidate` is on, and this runs inside the
 * move transaction's `onSuccess`, so awaiting it would hold the caller's
 * promise (and the "moved" toast) for one extra list round-trip.
 *
 * Scoped to the active workspace and the library the move happened in: other
 * libraries never list this row under these parents.
 */
export const applyResourceMoveToListCaches = async (
  resource: ResourceItem,
  { fromParentKeys, toParentKeys }: ResourceMoveCachePatch,
) => {
  const workspaceId = getActiveWorkspaceId();
  const libraryId = useFileStore.getState().queryParams?.libraryId;
  const toKeys = new Set(toParentKeys);
  const fromKeys = new Set(fromParentKeys.filter((key) => !toKeys.has(key)));
  const movedResource = stripOptimistic(resource);

  const isToKey = (key: unknown) => isResourceListKeyForParent(key, workspaceId, libraryId, toKeys);
  const isFromKey = (key: unknown) =>
    isResourceListKeyForParent(key, workspaceId, libraryId, fromKeys);

  await Promise.all([
    toKeys.size > 0 &&
      mutate(
        isToKey,
        async (currentData: ResourceListData | undefined) => {
          if (!currentData) return currentData;

          const remaining = currentData.items.filter((item) => item.id !== movedResource.id);
          const removed = currentData.items.length - remaining.length;

          return {
            ...currentData,
            items: [movedResource, ...remaining],
            total: currentData.total === undefined ? undefined : currentData.total - removed + 1,
          };
        },
        { revalidate: false },
      ),
    fromKeys.size > 0 &&
      mutate(
        isFromKey,
        async (currentData: ResourceListData | undefined) => {
          if (!currentData) return currentData;

          const remaining = currentData.items.filter((item) => item.id !== movedResource.id);
          if (remaining.length === currentData.items.length) return currentData;

          return {
            ...currentData,
            items: remaining,
            total: currentData.total === undefined ? undefined : Math.max(0, currentData.total - 1),
          };
        },
        { revalidate: false },
      ),
  ]);

  // Reconcile whichever of these keys is mounted, off the caller's critical path.
  void mutate(
    (key) => (toKeys.size > 0 && isToKey(key)) || (fromKeys.size > 0 && isFromKey(key)),
    async (currentData: ResourceListData | undefined) => currentData,
    { revalidate: true },
  );
};

/**
 * Custom SWR hook for fetching resources with caching and revalidation
 */
export const useFetchResources = (params: ResourceQueryParams | null, enable: any = true) => {
  const workspaceId = useActiveWorkspaceId();

  const swr = useClientDataSWR(
    enable && params ? resourceKeys.list(params, workspaceId) : null,
    async ([, queryParams]: ResourceSWRKey) => {
      const response = await resourceService.queryResources({
        ...queryParams,
        limit: queryParams.limit || 50,
        offset: 0,
      });
      return response;
    },
    {
      // Skip background revalidation when a fresh fetch for the same key
      // happened recently. Cache-hit display still works because the
      // useEffect below syncs swr.data → store regardless of whether the
      // fetcher actually ran.
      dedupingInterval: 30 * 1000,
      revalidateOnFocus: true,
      revalidateOnReconnect: true,
    },
  );

  // Sync SWR data → store on every data ref change.
  // Using useEffect (not onSuccess) covers the cache-hit path: when the key
  // changes to a previously-fetched folder, SWR returns cached data synchronously
  // without firing onSuccess. Reading the store mirror alone would surface the
  // previously-written folder's data until revalidation completes.
  const data = swr.data;
  useEffect(() => {
    if (!data || !params) return;

    const { hasMore, queryParams, resourceList, resourceMap, total } = useFileStore.getState();
    const merged = mergeServerResourcesWithOptimistic(data.items, resourceMap, params);

    if (
      !isEqual(queryParams, params) ||
      hasMore !== data.hasMore ||
      total !== data.total ||
      !isEqual(merged.resourceList, resourceList) ||
      !isEqual(merged.resourceMap, resourceMap)
    ) {
      useFileStore.setState(
        {
          hasMore: data.hasMore,
          offset: data.items.length,
          queryParams: params,
          resourceList: merged.resourceList,
          resourceMap: merged.resourceMap,
          total: data.total,
        },
        false,
        'useFetchResources/sync',
      );
    }
  }, [data, params]);

  return swr;
};

/**
 * Hook to access resource store state
 */
export const useResourceStore = () => {
  return useFileStore(
    (s) => ({
      hasMore: s.hasMore,
      queryParams: s.queryParams,
      resourceList: s.resourceList,
      resourceMap: s.resourceMap,
      total: s.total,
    }),
    shallow,
  );
};

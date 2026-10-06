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

/**
 * The workspace and library a move was issued from. Captured *before* the
 * request (`prepareResourceMoveCachePatch` on the file store): the user may
 * switch workspace or library while it is in flight, and the caches to patch
 * are the ones that listed the row, not the newly active scope.
 */
export interface ResourceMoveCacheScope {
  /** Library the explorer was showing, `undefined` outside a library. */
  libraryId: string | undefined;
  workspaceId: string | null;
}

export interface ResourceMoveCachePatch {
  /** Every key the source folder may be addressed by in `queryParams.parentId`. */
  fromParentKeys: ResourceParentKey[];
  scope: ResourceMoveCacheScope;
  /** Every key the destination folder may be addressed by in `queryParams.parentId`. */
  toParentKeys: ResourceParentKey[];
}

const isResourceListKeyForParent = (
  key: unknown,
  { workspaceId, libraryId }: ResourceMoveCacheScope,
  parentKeys: Set<ResourceParentKey>,
): key is ResourceSWRKey => {
  if (!Array.isArray(key)) return false;
  if (key[0] !== resourceKeys.list.root || key[2] !== workspaceId) return false;

  const params = key[1] as ResourceQueryParams | undefined;
  if (!params || params.libraryId !== libraryId) return false;

  return parentKeys.has(params.parentId ?? null);
};

/**
 * Whether a cached list is a plain folder listing the moved row certainly
 * belongs to. A list narrowed by a keyword, a category tab, a source chip or a
 * visibility mode may or may not include the row, and the server owns those
 * rules; such variants are left for revalidation rather than seeded with a row
 * that might not match. The personal root's default `showFilesInKnowledgeBase:
 * false` hides library rows, so a row that belongs to a library stays out.
 */
const listsMovedRowUnfiltered = (params: ResourceQueryParams, resource: ResourceItem) => {
  if (params.q?.trim()) return false;
  if (params.category && params.category !== 'all') return false;
  if (params.sourceFilter && params.sourceFilter !== 'all') return false;
  if (params.visibility) return false;
  if (!params.libraryId && !params.showFilesInKnowledgeBase && resource.knowledgeBaseId) {
    return false;
  }
  return true;
};

const stripOptimistic = (resource: ResourceItem): ResourceItem => {
  const { _optimistic, ...rest } = resource;
  void _optimistic;
  return rest;
};

const toTime = (value: Date | string | number | undefined | null) =>
  value == null ? 0 : new Date(value).getTime();

const SORT_ACCESSORS: Record<string, (item: ResourceItem) => number | string> = {
  createdAt: (item) => toTime(item.createdAt),
  name: (item) => item.name ?? '',
  size: (item) => item.size ?? 0,
  updatedAt: (item) => toTime(item.updatedAt),
};

/**
 * The order the server returns a list in, mirrored from the knowledge
 * repository's `orderBy`: both `sorter` and `sortType` have to be present for a
 * custom sort, anything else is newest-first.
 */
const compareResourcesForList = ({ sorter, sortType }: ResourceQueryParams) => {
  const custom = sorter && sortType && sorter in SORT_ACCESSORS;
  const accessor = custom ? SORT_ACCESSORS[sorter] : SORT_ACCESSORS.createdAt;
  const direction = custom && String(sortType).toLowerCase() === 'asc' ? 1 : -1;

  return (a: ResourceItem, b: ResourceItem) => {
    const left = accessor(a);
    const right = accessor(b);
    const order =
      typeof left === 'string' && typeof right === 'string'
        ? left.localeCompare(right)
        : Number(left) - Number(right);
    return order * direction;
  };
};

/**
 * Put the moved row where the server would list it. A cached page keeps its
 * length: `useFetchResources` derives the next `offset` from the cached row
 * count, so a page that grew past its limit would make "load more" skip a
 * server row. On a full page the row is either placed in order (the row that
 * falls off the end reappears at that same server offset) or, when it sorts
 * past everything cached, left for the later page that will contain it.
 */
export const patchDestinationList = (
  currentData: ResourceListData | undefined,
  movedResource: ResourceItem,
  params: ResourceQueryParams,
): ResourceListData | undefined => {
  if (!currentData) return currentData;

  const remaining = currentData.items.filter((item) => item.id !== movedResource.id);
  const removed = currentData.items.length - remaining.length;
  const total = currentData.total === undefined ? undefined : currentData.total - removed + 1;

  const compare = compareResourcesForList(params);
  const position = remaining.findIndex((item) => compare(movedResource, item) < 0);
  const inserted =
    position === -1
      ? [...remaining, movedResource]
      : [...remaining.slice(0, position), movedResource, ...remaining.slice(position)];

  const pageLength = currentData.items.length;
  if (!currentData.hasMore || inserted.length <= pageLength) {
    return { ...currentData, items: inserted, total };
  }

  return {
    ...currentData,
    items: position === -1 ? remaining : inserted.slice(0, pageLength),
    total,
  };
};

export const patchSourceList = (
  currentData: ResourceListData | undefined,
  movedResource: ResourceItem,
): ResourceListData | undefined => {
  if (!currentData) return currentData;

  const remaining = currentData.items.filter((item) => item.id !== movedResource.id);
  if (remaining.length === currentData.items.length) return currentData;

  return {
    ...currentData,
    items: remaining,
    total: currentData.total === undefined ? undefined : Math.max(0, currentData.total - 1),
  };
};

/**
 * List the cached keys a matcher accepts without touching their data: the
 * collecting matcher never accepts, so SWR mutates nothing.
 */
const collectCachedListKeys = async (matcher: (key: unknown) => key is ResourceSWRKey) => {
  const keys: ResourceSWRKey[] = [];
  await mutate(
    (key) => {
      if (matcher(key)) keys.push(key);
      return false;
    },
    undefined,
    { revalidate: false },
  );
  return keys;
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
 * Destination entries are patched one key at a time because the row's place
 * depends on that key's sort (see `patchDestinationList`); the updater SWR
 * hands us does not know which key it is running for. Filtered variants of the
 * destination (see `listsMovedRowUnfiltered`) are only revalidated.
 *
 * The patches are written with `revalidate: false` and the reconciling refetch
 * of any mounted key is fired without being awaited: SWR's `mutate` resolves
 * only after that refetch when `revalidate` is on, and this runs inside the
 * move transaction's `onSuccess`, so awaiting it would hold the caller's
 * promise (and the "moved" toast) for one extra list round-trip.
 *
 * Scoped to the workspace and library the move was issued from: other
 * libraries never list this row under these parents.
 */
const applyMoveToListCaches = async (
  resource: ResourceItem,
  { fromParentKeys, toParentKeys, scope }: ResourceMoveCachePatch,
) => {
  const toKeys = new Set(toParentKeys);
  const fromKeys = new Set(fromParentKeys.filter((key) => !toKeys.has(key)));
  const movedResource = stripOptimistic(resource);

  const isToKey = (key: unknown) => isResourceListKeyForParent(key, scope, toKeys);
  const isFromKey = (key: unknown) => isResourceListKeyForParent(key, scope, fromKeys);
  // Removing from the source is safe for every variant; inserting is not.
  const isSeedableToKey = (key: unknown): key is ResourceSWRKey =>
    isToKey(key) && listsMovedRowUnfiltered(key[1], movedResource);

  const destinationKeys = toKeys.size > 0 ? await collectCachedListKeys(isSeedableToKey) : [];

  await Promise.all([
    ...destinationKeys.map((cachedKey) =>
      mutate(
        (key) => isEqual(key, cachedKey),
        async (currentData: ResourceListData | undefined) =>
          patchDestinationList(currentData, movedResource, cachedKey[1]),
        { revalidate: false },
      ),
    ),
    fromKeys.size > 0 &&
      mutate(
        isFromKey,
        async (currentData: ResourceListData | undefined) =>
          patchSourceList(currentData, movedResource),
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

let pendingMovePatches: Promise<unknown> = Promise.resolve();

/**
 * Patches run one at a time. A multi-item move lands its requests together and
 * every item patches the same source / destination keys; SWR's `mutate` reads
 * the cached list before awaiting the updater and drops a write whose read was
 * overtaken by a later mutation of the same key, so concurrent patches would
 * lose all but the last row. Serialising here covers every caller — the
 * explorer's own moves and the tree's API-only branches alike.
 */
export const applyResourceMoveToListCaches = (
  resource: ResourceItem,
  patch: ResourceMoveCachePatch,
): Promise<void> => {
  const run = pendingMovePatches.then(
    () => applyMoveToListCaches(resource, patch),
    () => applyMoveToListCaches(resource, patch),
  );
  pendingMovePatches = run.catch(() => {});
  return run;
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

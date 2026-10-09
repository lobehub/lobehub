import { shallow } from 'zustand/shallow';

import { revalidateReplica } from '@/libs/replica';
import { type ResourceQueryParams } from '@/types/resource';

import { useFileStore } from '../../store';
import { resourceListResource } from './projection';

/** Parent identifiers for one folder: its id, its slug, or `null` for the root. */
export type ResourceParentKey = string | null;

/**
 * The workspace and library a move was issued from. Captured *before* the
 * request (`prepareResourceMoveCachePatch` on the file store): the user may
 * switch workspace or library while it is in flight, and the rows to reconcile
 * belong to the scope that listed them, not the newly active one.
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

/**
 * Revalidate resources with current or specific query params.
 * This can be called from outside React components (e.g., store actions).
 */
export const revalidateResources = async (params?: ResourceQueryParams) => {
  const queryParams = params || useFileStore.getState().queryParams;
  if (!queryParams) return;

  await revalidateReplica(resourceListResource);
};

/**
 * Keep the explorer list in step with a move.
 *
 * The explorer list is a local-first replica now: `moveResource` already patches
 * the in-memory view optimistically and revalidates the mounted query, and a
 * later visit to either folder hydrates from its persisted head page and then
 * confirms it over the network. This entry point stays for the sidebar tree's
 * API-only move path, which does not go through the explorer's own action.
 */
export const applyResourceMoveToListCaches = async (): Promise<void> => {
  await revalidateResources();
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

/**
 * Custom hook for fetching resources: hydrates the persisted head page and
 * revalidates it. Read the rows from the store, not from this hook's return.
 */
export const useFetchResources = (params: ResourceQueryParams | null, enable: boolean = true) =>
  useFileStore((s) => s.useFetchResources)(params, enable);

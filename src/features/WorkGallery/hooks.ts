import { useCallback, useEffect, useMemo } from 'react';

import { useActiveWorkspaceId } from '@/business/client/hooks/useActiveWorkspaceId';
import { useResourceManagerStore } from '@/features/ResourceManager/store';
import type { ResourceListVisibilityFilter } from '@/features/ResourceManager/store/initialState';
import { getResourceQueryVisibility } from '@/features/ResourceManager/store/selectors';
import { useWorkStore, workActions, workSelectors, type WorkspaceWorksParams } from '@/store/work';

import { workFilterFromKey, type WorkGalleryKey } from './const';

const EMPTY_ITEMS: never[] = [];

/**
 * Replica params of one gallery filter. Personal Works have no workspace mode
 * switch, so keep the historical unfiltered query there. Inside a workspace,
 * mirror every other Resources surface: Private means caller-owned private
 * rows; Workspace means public rows shared with the team.
 */
export const workspaceWorksParams = (
  galleryKey: WorkGalleryKey,
  workspaceId: string | null,
  listVisibility: ResourceListVisibilityFilter,
): WorkspaceWorksParams => {
  const { provider, type } = workFilterFromKey(galleryKey);
  return {
    provider,
    type,
    visibility: workspaceId ? getResourceQueryVisibility(undefined, listVisibility) : undefined,
    workspaceId,
  };
};

/**
 * Cursor-paginated, infinite-scrolling Work summaries scoped to the active
 * workspace (or personal space). `galleryKey` selects the filter (a Work type,
 * a skill provider, or the combined `all` view). Each filter is its own
 * local-first replica entry: a revisit or reload paints the last head page
 * while the network confirms; switching back to a filter collapses it to that
 * head page.
 */
export const useWorkspaceWorksInfinite = (galleryKey: WorkGalleryKey) => {
  const workspaceId = useActiveWorkspaceId();
  const listVisibility = useResourceManagerStore((s) => s.listVisibility);
  const { provider, type, visibility } = workspaceWorksParams(
    galleryKey,
    workspaceId,
    listVisibility,
  );
  const params = useMemo<WorkspaceWorksParams>(
    () => ({ provider, type, visibility, workspaceId }),
    [provider, type, visibility, workspaceId],
  );

  const list = useWorkStore(workSelectors.workspaceWorks(params));
  const { error: headError, isValidating, revalidate } = workActions.useFetchWorkspaceWorks(params);

  // A filter switched to starts again from its head page, not the pages an
  // earlier visit loaded.
  useEffect(() => {
    workActions.collapseWorkspaceWorks(params);
  }, [params]);

  const loadMoreError = list?.loadMoreError;
  const loadMore = useCallback(() => {
    void workActions.loadMoreWorkspaceWorks(params);
  }, [params]);
  // The inline retry re-asks for the page that failed; a head failure
  // revalidates the head.
  const reload = useCallback(() => {
    if (loadMoreError) loadMore();
    else void revalidate();
  }, [loadMore, loadMoreError, revalidate]);

  const error = headError ?? loadMoreError;
  // `undefined` = nothing painted yet (no stored copy, no response).
  const isLoadingInitial = list === undefined && !headError;

  return {
    error,
    // Pause the sentinel while an error is showing so it can't hot-loop the
    // failed page; the gallery offers a manual retry (`reload`) instead.
    hasMore: !!list?.hasMore && !error,
    isLoadingInitial,
    isLoadingMore: !!list?.isLoadingMore,
    isValidating,
    items: list?.items ?? EMPTY_ITEMS,
    loadMore,
    reload,
  };
};

import { useCallback, useEffect } from 'react';
import useSWRInfinite from 'swr/infinite';

import { useActiveWorkspaceId } from '@/business/client/hooks/useActiveWorkspaceId';
import { useResourceManagerStore } from '@/features/ResourceManager/store';
import { getResourceQueryVisibility } from '@/features/ResourceManager/store/selectors';
import { workKeys } from '@/libs/swr/keys';
import type { WorkSummaryPage } from '@/services/work';
import { workService } from '@/services/work';

import { workFilterFromKey, type WorkGalleryKey } from './const';

const WORK_GALLERY_PAGE_SIZE = 30;

/**
 * Cursor-paginated, infinite-scrolling Work summaries scoped to the active
 * workspace (or personal space). `galleryKey` selects the filter (a Work type,
 * a skill provider, or the combined `all` view). Changing it collapses back to
 * the first page. Mirrors `useVerifyReportSummariesInfinite`.
 */
export const useWorkspaceWorksInfinite = (galleryKey: WorkGalleryKey) => {
  const workspaceId = useActiveWorkspaceId();
  const listVisibility = useResourceManagerStore((s) => s.listVisibility);
  const filter = workFilterFromKey(galleryKey);
  // Personal Works have no workspace mode switch, so keep the historical
  // unfiltered query there. Inside a workspace, mirror every other Resources
  // surface: Private means caller-owned private rows; Workspace means public
  // rows shared with the team.
  const visibility = workspaceId
    ? getResourceQueryVisibility(undefined, listVisibility)
    : undefined;

  const getKey = useCallback(
    (_index: number, previous: WorkSummaryPage | null) => {
      // Stop paging once the previous page reported no further cursor.
      if (previous && previous.nextCursor === null) return null;
      return workKeys.workspace(
        workspaceId,
        galleryKey,
        previous?.nextCursor ?? undefined,
        visibility,
      );
    },
    [galleryKey, visibility, workspaceId],
  );

  const { data, error, isLoading, isValidating, mutate, setSize, size } = useSWRInfinite(
    getKey,
    ([, , , cursor, keyVisibility]: readonly [
      string,
      string | null,
      string,
      string | null,
      'private' | 'public' | null,
    ]) =>
      workService.listByWorkspace({
        cursor: cursor || undefined,
        limit: WORK_GALLERY_PAGE_SIZE,
        provider: filter.provider,
        type: filter.type ?? null,
        visibility: keyVisibility ?? undefined,
      }),
    { revalidateFirstPage: false },
  );

  // A new filter starts a fresh key series; collapse size back to 1 so we
  // don't cascade-fetch as many pages as the previous filter had loaded.
  useEffect(() => {
    setSize(1);
  }, [galleryKey, setSize, visibility]);

  const loadMore = useCallback(() => {
    void setSize((s) => s + 1);
  }, [setSize]);
  const reload = useCallback(() => {
    void mutate();
  }, [mutate]);

  // SWR leaves a failed/pending page's slot `undefined`, so guard the holes.
  const items = data?.flatMap((page) => page?.items ?? []) ?? [];
  const lastLoadedPage = data?.findLast(Boolean);
  const reachedEnd = lastLoadedPage ? lastLoadedPage.nextCursor === null : false;

  // A subsequent page is genuinely in flight only when it hasn't errored — an
  // errored page also leaves its slot undefined, but must not read as loading.
  const isLoadingMore =
    !error && (isLoading || (size > 0 && !!data && typeof data[size - 1] === 'undefined'));

  // Pause the sentinel while an error is showing so it can't hot-loop the failed
  // page; the gallery offers a manual retry (`reload`) instead.
  const hasMore = !reachedEnd && !error;

  return {
    error,
    hasMore,
    isLoadingInitial: isLoading,
    isLoadingMore,
    isValidating,
    items,
    loadMore,
    reload,
  };
};

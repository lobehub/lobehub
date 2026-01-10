'use client';

import { Flexbox } from '@lobehub/ui';
import { memo, useEffect, useMemo } from 'react';

import { useFolderPath } from '@/app/[variants]/(main)/resource/features/hooks/useFolderPath';
import { useResourceManagerUrlSync } from '@/app/[variants]/(main)/resource/features/hooks/useResourceManagerUrlSync';
import { useResourceManagerStore } from '@/app/[variants]/(main)/resource/features/store';
import { sortFileList } from '@/app/[variants]/(main)/resource/features/store/selectors';
import { useFetchResources, useResourceStore } from '@/store/file/slices/resource/hooks';

import EmptyPlaceholder from './EmptyPlaceholder';
import Header from './Header';
import ListView from './ListView';
import ListViewSkeleton from './ListView/Skeleton';
import MasonryView from './MasonryView';
import MasonryViewSkeleton from './MasonryView/Skeleton';
import { useCheckTaskStatus } from './useCheckTaskStatus';
import { useMasonryColumnCount } from './useMasonryColumnCount';
import { useResourceExplorer } from './useResourceExplorer';

/**
 * Explore resource items in a library
 *
 * Works with FileTree
 *
 * It's a un-reusable component for business logic only.
 * So we depend on context, not props.
 */
const ResourceExplorer = memo(() => {
  // Sync store state with URL query parameters
  useResourceManagerUrlSync();

  // Get state from Resource Manager store
  const [
    libraryId,
    category,
    viewMode,
    isTransitioning,
    isMasonryReady,
    searchQuery,
    setSelectedFileIds,
    sorter,
    sortType,
  ] = useResourceManagerStore((s) => [
    s.libraryId,
    s.category,
    s.viewMode,
    s.isTransitioning,
    s.isMasonryReady,
    s.searchQuery,
    s.setSelectedFileIds,
    s.sorter,
    s.sortType,
  ]);

  // Get folder path for empty state check
  const { currentFolderSlug } = useFolderPath();

  // Build query params for SWR
  const queryParams = useMemo(
    () => ({
      // Only use category filter when NOT in a specific library
      // When viewing a library, show all items regardless of category
      category: libraryId ? undefined : category,
      libraryId,
      parentId: currentFolderSlug || null,
      q: searchQuery ?? undefined,
      showFilesInKnowledgeBase: false,
      sortType,
      sorter,
    }),
    [category, libraryId, currentFolderSlug, searchQuery, sortType, sorter],
  );

  // Use SWR for data fetching with automatic caching and revalidation
  const { isLoading, isValidating } = useFetchResources(queryParams);

  // Get resource data from store (updated by SWR hook)
  const { resourceList, queryParams: currentQueryParams } = useResourceStore();

  // Check if we're navigating to a different view (different query params)
  const isNavigating = useMemo(() => {
    if (!currentQueryParams || !queryParams) return false;

    return (
      currentQueryParams.libraryId !== queryParams.libraryId ||
      currentQueryParams.parentId !== queryParams.parentId ||
      currentQueryParams.category !== queryParams.category ||
      currentQueryParams.q !== queryParams.q
    );
  }, [currentQueryParams, queryParams]);

  // Map ResourceItem[] to FileListItem[] for compatibility
  // TODO: Eventually update all consumers to use ResourceItem directly
  const rawData = resourceList?.map((item) => ({
    ...item,
    // Ensure all FileListItem fields are present with proper types
    chunkCount: item.chunkCount ?? null,
    chunkingError: item.chunkingError ?? null,
    chunkingStatus: (item.chunkingStatus ?? null) as any,
    embeddingError: item.embeddingError ?? null,
    embeddingStatus: (item.embeddingStatus ?? null) as any,
    finishEmbedding: item.finishEmbedding ?? false,
    url: item.url ?? '',
  }));

  // Sort data using current sort settings
  const data = sortFileList(rawData, sorter, sortType);

  // Check task status
  useCheckTaskStatus(data);

  // Initialize folder/file navigation effects (still need hook for complex effects)
  useResourceExplorer({ category, libraryId });

  // Clear selections when category/library/search changes
  useEffect(() => {
    setSelectedFileIds([]);
  }, [category, libraryId, searchQuery, setSelectedFileIds]);

  // Computed values
  const columnCount = useMasonryColumnCount();

  // Show skeleton when:
  // 1. Initial load with no data (isLoading && no data)
  // 2. Navigating to different folder/category (isNavigating && isValidating)
  // 3. View mode transitions
  const showSkeleton =
    (isLoading && (!data || data.length >= 5)) ||
    (isNavigating && isValidating) ||
    (viewMode === 'list' && isTransitioning) ||
    (viewMode === 'masonry' && (isTransitioning || !isMasonryReady));

  const showEmptyStatus = !isLoading && !isValidating && data?.length === 0 && !currentFolderSlug;

  return (
    <Flexbox height={'100%'}>
      <Header />
      {showEmptyStatus ? (
        <EmptyPlaceholder />
      ) : showSkeleton ? (
        viewMode === 'list' ? (
          <ListViewSkeleton />
        ) : (
          <MasonryViewSkeleton columnCount={columnCount} />
        )
      ) : viewMode === 'list' ? (
        <ListView />
      ) : (
        <MasonryView />
      )}
    </Flexbox>
  );
});

ResourceExplorer.displayName = 'ResourceExplorer';

export default ResourceExplorer;

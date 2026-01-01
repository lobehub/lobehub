'use client';

import { Flexbox } from '@lobehub/ui';
import { memo, useEffect } from 'react';

import { useFolderPath } from '@/app/[variants]/(main)/resource/features/hooks/useFolderPath';
import { useResourceManagerUrlSync } from '@/app/[variants]/(main)/resource/features/hooks/useResourceManagerUrlSync';
import {
  useResourceManagerFetchKnowledgeItems,
  useResourceManagerStore,
} from '@/app/[variants]/(main)/resource/features/store';
import { sortFileList } from '@/app/[variants]/(main)/resource/features/store/selectors';

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
    selectedFileIds,
    setSelectedFileIds,
    loadMoreKnowledgeItems,
    fileListHasMore,
    sorter,
    sortType,
  ] = useResourceManagerStore((s) => [
    s.libraryId,
    s.category,
    s.viewMode,
    s.isTransitioning,
    s.isMasonryReady,
    s.searchQuery,
    s.selectedFileIds,
    s.setSelectedFileIds,
    s.loadMoreKnowledgeItems,
    s.fileListHasMore,
    s.sorter,
    s.sortType,
  ]);

  // Get folder path for empty state check
  const { currentFolderSlug } = useFolderPath();

  // Fetch data with SWR - uses built-in cache for instant category switching
  const { data: rawData, isLoading } = useResourceManagerFetchKnowledgeItems({
    category,
    knowledgeBaseId: libraryId,
    parentId: currentFolderSlug || null,
    q: searchQuery ?? undefined,
    showFilesInKnowledgeBase: false,
  });

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
  const showEmptyStatus = !isLoading && data?.length === 0 && !currentFolderSlug;

  const columnCount = useMasonryColumnCount();

  // Only show skeleton on INITIAL load or view transitions, not during revalidation
  // This allows cached data to show instantly while revalidating in background
  const showSkeleton =
    (isLoading && !data) || // Only show skeleton if truly loading with no cached data
    (viewMode === 'list' && isTransitioning) ||
    (viewMode === 'masonry' && (isTransitioning || !isMasonryReady));

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
        <MasonryView
          data={data}
          hasMore={fileListHasMore}
          isMasonryReady={isMasonryReady}
          loadMore={loadMoreKnowledgeItems}
          selectFileIds={selectedFileIds}
          setSelectedFileIds={setSelectedFileIds}
        />
      )}
    </Flexbox>
  );
});

ResourceExplorer.displayName = 'ResourceExplorer';

export default ResourceExplorer;

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
import MasonryView from './MasonryView';
import { useCheckTaskStatus } from './useCheckTaskStatus';
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
  const [libraryId, category, viewMode, searchQuery, setSelectedFileIds, sorter, sortType] =
    useResourceManagerStore((s) => [
      s.libraryId,
      s.category,
      s.viewMode,
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
  const { resourceList } = useResourceStore();

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

  const showEmptyStatus = !isLoading && !isValidating && data?.length === 0 && !currentFolderSlug;

  return (
    <Flexbox height={'100%'}>
      <Header />
      {showEmptyStatus ? (
        <EmptyPlaceholder />
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

'use client';

import { useEffect } from 'react';
import { type SWRResponse } from 'swr';
import { subscribeWithSelector } from 'zustand/middleware';
import { shallow } from 'zustand/shallow';
import { createWithEqualityFn } from 'zustand/traditional';

import { useFileStore } from '@/store/file';
import { type FileListItem, type QueryFileListParams } from '@/types/files';

import { type FolderCrumb } from './action';
import { store } from './action';

export type { State } from './initialState';

// Create a global store instance instead of context-based
export const useResourceManagerStore = createWithEqualityFn(
  subscribeWithSelector(store()),
  shallow,
);

export { selectors } from './selectors';

/**
 * Hook wrappers that delegate to FileStore hooks and sync pagination state
 * These must be separate functions, not stored in Zustand state
 */

export const useResourceManagerFetchKnowledgeItems = (
  params: QueryFileListParams,
): SWRResponse<FileListItem[]> => {
  const result = useFileStore((s) => s.useFetchKnowledgeItems)(params);

  // Sync pagination state from FileStore to ResourceManagerStore using subscription
  // This ensures the sync happens reactively when FileStore updates, not just during render
  const fileListHasMore = useFileStore((s) => s.fileListHasMore);
  const fileListOffset = useFileStore((s) => s.fileListOffset);

  useEffect(() => {
    const resourceManagerStore = useResourceManagerStore.getState();
    resourceManagerStore.setFileListHasMore?.(fileListHasMore);
    resourceManagerStore.setFileListOffset?.(fileListOffset);
  }, [fileListHasMore, fileListOffset]);

  return result;
};

export const useResourceManagerFetchKnowledgeItem = (
  id?: string,
): SWRResponse<FileListItem | undefined> => {
  return useFileStore((s) => s.useFetchKnowledgeItem)(id);
};

export const useResourceManagerFetchFolderBreadcrumb = (
  slug?: string | null,
): SWRResponse<FolderCrumb[]> => {
  return useFileStore((s) => s.useFetchFolderBreadcrumb)(slug);
};

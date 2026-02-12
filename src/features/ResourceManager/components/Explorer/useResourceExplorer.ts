import { useCallback, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';

import { useFolderPath } from '@/app/[variants]/(main)/resource/features/hooks/useFolderPath';
import {
  useResourceManagerFetchFolderBreadcrumb,
  useResourceManagerFetchKnowledgeItem,
  useResourceManagerFetchKnowledgeItems,
  useResourceManagerStore,
} from '@/app/[variants]/(main)/resource/features/store';
import { type MultiSelectActionType } from '@/app/[variants]/(main)/resource/features/store/action';
import { selectors, sortFileList } from '@/app/[variants]/(main)/resource/features/store/selectors';
import { useAddFilesToKnowledgeBaseModal } from '@/features/LibraryModal';
import { fileManagerSelectors, useFileStore } from '@/store/file';
import { type FilesTabs } from '@/types/files';

import { useFileSelection } from './hooks/useFileSelection';
import { useCheckTaskStatus } from './useCheckTaskStatus';

interface UseFileExplorerProps {
  category?: FilesTabs;
  libraryId?: string;
}

export const useResourceExplorer = ({
  category: categoryProp,
  libraryId,
}: UseFileExplorerProps) => {
  const [, setSearchParams] = useSearchParams();

  // Get state from Resource Manager store
  const [
    viewMode,
    currentViewItemId,
    isTransitioning,
    isMasonryReady,
    searchQuery,
    setCurrentFolderId,
    setIsTransitioning,
    setIsMasonryReady,
    handleBackToList,
    onActionClick,
    pendingRenameItemId,
    loadMoreKnowledgeItems,
    fileListHasMore,
    sorter,
    sortType,
  ] = useResourceManagerStore((s) => [
    s.viewMode,
    s.currentViewItemId,
    s.isTransitioning,
    s.isMasonryReady,
    s.searchQuery,
    s.setCurrentFolderId,
    s.setIsTransitioning,
    s.setIsMasonryReady,
    s.handleBackToList,
    s.onActionClick,
    s.pendingRenameItemId,
    s.loadMoreKnowledgeItems,
    s.fileListHasMore,
    s.sorter,
    s.sortType,
  ]);

  const categoryFromStore = useResourceManagerStore((s) => s.category);
  const category = categoryProp ?? categoryFromStore;

  // Folder navigation
  const { currentFolderSlug } = useFolderPath();

  // Current file
  const { data: fetchedCurrentFile } = useResourceManagerFetchKnowledgeItem(currentViewItemId);
  const currentFile =
    useFileStore(fileManagerSelectors.getFileById(currentViewItemId)) || fetchedCurrentFile;

  // Folder operations
  const { data: folderBreadcrumb } = useResourceManagerFetchFolderBreadcrumb(currentFolderSlug);

  // Fetch data with SWR
  const { data: rawData, isLoading } = useResourceManagerFetchKnowledgeItems({
    category,
    knowledgeBaseId: libraryId,
    parentId: currentFolderSlug || null,
    q: searchQuery ?? undefined,
    showFilesInKnowledgeBase: false,
  });

  // Sort data using current sort settings
  const data = sortFileList(rawData, sorter, sortType);

  const { handleSelectionChange, selectFileIds, setSelectedFileIds } = useFileSelection(data);

  useCheckTaskStatus(data);

  // Get modal handler for knowledge base operations
  const { open: openAddModal } = useAddFilesToKnowledgeBaseModal();

  // Wrap onActionClick to handle modal operations that need React hooks
  const handleActionClick = useCallback(
    async (type: MultiSelectActionType) => {
      // Handle modal-based actions here (can't be in store due to React hooks)
      if (type === 'addToKnowledgeBase') {
        openAddModal({
          fileIds: selectFileIds,
          onClose: () => setSelectedFileIds([]),
        });
        return;
      }

      if (type === 'moveToOtherKnowledgeBase') {
        openAddModal({
          fileIds: selectFileIds,
          knowledgeBaseId: libraryId,
          onClose: () => setSelectedFileIds([]),
        });
        return;
      }

      // Delegate other actions to store
      await onActionClick(type);
    },
    [onActionClick, openAddModal, selectFileIds, setSelectedFileIds, libraryId],
  );

  // Wrap handleBackToList to also update URL params
  const handleBackToListWithUrl = useCallback(() => {
    handleBackToList();
    setSearchParams((prev) => {
      const newParams = new URLSearchParams(prev);
      newParams.delete('file');
      return newParams;
    });
  }, [handleBackToList, setSearchParams]);

  // Effects - Folder navigation
  useEffect(() => {
    if (!currentFolderSlug) {
      setCurrentFolderId(null);
    } else if (folderBreadcrumb && folderBreadcrumb.length > 0) {
      const currentFolder = folderBreadcrumb.at(-1);
      setCurrentFolderId(currentFolder?.id ?? null);
    }
  }, [currentFolderSlug, folderBreadcrumb, setCurrentFolderId]);

  // Handle view mode transition effects
  useEffect(() => {
    if (viewMode === 'masonry') {
      setIsTransitioning(true);
      setIsMasonryReady(false);
    }
  }, [viewMode, setIsTransitioning, setIsMasonryReady]);

  useEffect(() => {
    if (isTransitioning && data) {
      requestAnimationFrame(() => {
        const timer = setTimeout(() => {
          setIsTransitioning(false);
        }, 100);
        return () => clearTimeout(timer);
      });
    }
  }, [isTransitioning, data, setIsTransitioning]);

  useEffect(() => {
    if (viewMode === 'masonry' && data && !isLoading && !isTransitioning) {
      const timer = setTimeout(() => {
        setIsMasonryReady(true);
      }, 300);
      return () => clearTimeout(timer);
    } else if (viewMode === 'list') {
      setIsMasonryReady(false);
    }
  }, [viewMode, data, isLoading, isTransitioning, setIsMasonryReady]);

  const showEmptyStatus = !isLoading && data?.length === 0 && !currentFolderSlug;
  const isFilePreviewMode = useResourceManagerStore(selectors.isFilePreviewMode);

  return {
    // Data
    category,
    currentFile,
    currentFolderSlug,
    currentViewItemId,
    data,
    // Handlers
    handleBackToList: handleBackToListWithUrl,

    handleSelectionChange,

    hasMore: fileListHasMore,

    isFilePreviewMode,

    isLoading,

    // State
    isMasonryReady,

    isTransitioning,

    // Pagination
    loadMoreKnowledgeItems,

    onActionClick: handleActionClick,

    pendingRenameItemId,

    selectFileIds,
    setSelectedFileIds,
    showEmptyStatus,
    viewMode,
  };
};

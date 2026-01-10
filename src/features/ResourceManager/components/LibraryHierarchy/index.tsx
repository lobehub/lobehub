'use client';

import { Flexbox } from '@lobehub/ui';
import { memo, useCallback, useEffect, useMemo, useReducer, useRef } from 'react';
import { VList } from 'virtua';

import { useFolderPath } from '@/app/[variants]/(main)/resource/features/hooks/useFolderPath';
import { useResourceManagerStore } from '@/app/[variants]/(main)/resource/features/store';
import { fileService } from '@/services/file';
import { useFileStore } from '@/store/file';

import { HierarchyNode } from './HierarchyNode';
import TreeSkeleton from './TreeSkeleton';
import { TREE_REFRESH_EVENT, getTreeState } from './treeState';
import type { TreeItem } from './types';

// Export for external use
export { clearTreeFolderCache } from './treeState';

/**
 * As a sidebar along with the Explorer
 */
const LibraryHierarchy = memo(() => {
  const { currentFolderSlug } = useFolderPath();

  const [useFetchKnowledgeItems, useFetchFolderBreadcrumb, useFetchKnowledgeItem] = useFileStore(
    (s) => [s.useFetchKnowledgeItems, s.useFetchFolderBreadcrumb, s.useFetchKnowledgeItem],
  );

  const [libraryId, currentViewItemId] = useResourceManagerStore((s) => [
    s.libraryId,
    s.currentViewItemId,
  ]);

  // Force re-render when tree state changes
  const [updateKey, forceUpdate] = useReducer((x) => x + 1, 0);

  // Get the persisted state for this knowledge base
  const state = useMemo(() => getTreeState(libraryId || ''), [libraryId]);
  const { expandedFolders, folderChildrenCache, loadingFolders } = state;

  // Fetch breadcrumb for current folder
  const { data: folderBreadcrumb } = useFetchFolderBreadcrumb(currentFolderSlug);

  // Fetch current file when viewing a file
  const { data: currentFile } = useFetchKnowledgeItem(currentViewItemId);

  // Track parent folder key for file selection - stored in a ref to avoid hook order issues
  const parentFolderKeyRef = useRef<string | null>(null);

  // Fetch root level data using SWR
  const { data: rootData, isLoading } = useFetchKnowledgeItems({
    knowledgeBaseId: libraryId,
    parentId: null,
    showFilesInKnowledgeBase: false,
  });

  // Sort items: folders first, then files
  const sortItems = useCallback(<T extends TreeItem>(items: T[]): T[] => {
    return [...items].sort((a, b) => {
      // Folders first
      if (a.isFolder && !b.isFolder) return -1;
      if (!a.isFolder && b.isFolder) return 1;
      // Then alphabetically by name
      return a.name.localeCompare(b.name);
    });
  }, []);

  // Convert root data to tree items
  const items: TreeItem[] = useMemo(() => {
    if (!rootData) return [];

    const mappedItems: TreeItem[] = rootData.map((item) => ({
      fileType: item.fileType,
      id: item.id,
      isFolder: item.fileType === 'custom/folder',
      name: item.name,
      slug: item.slug,
      sourceType: item.sourceType,
      url: item.url,
    }));

    return sortItems(mappedItems);
  }, [rootData, sortItems, updateKey]);

  const visibleNodes = useMemo(() => {
    interface VisibleNode {
      item: TreeItem;
      key: string;
      level: number;
    }

    const result: VisibleNode[] = [];

    const walk = (nodes: TreeItem[], level: number) => {
      for (const node of nodes) {
        const key = node.slug || node.id;

        result.push({ item: node, key, level });

        if (!node.isFolder) continue;
        if (!expandedFolders.has(key)) continue;

        const children = folderChildrenCache.get(key);
        if (!children || children.length === 0) continue;

        walk(children, level + 1);
      }
    };

    walk(items, 0);

    return result;
    // NOTE: expandedFolders / folderChildrenCache are mutated in-place, so rely on updateKey for recompute
  }, [items, expandedFolders, folderChildrenCache, updateKey]);

  const handleLoadFolder = useCallback(
    async (folderId: string) => {
      // Set loading state
      state.loadingFolders.add(folderId);
      forceUpdate();

      try {
        // Use SWR mutate to trigger a fetch that will be cached and shared with FileExplorer
        const { mutate: swrMutate } = await import('swr');
        const response = await swrMutate(
          [
            'useFetchKnowledgeItems',
            {
              knowledgeBaseId: libraryId,
              parentId: folderId,
              showFilesInKnowledgeBase: false,
            },
          ],
          () =>
            fileService.getKnowledgeItems({
              knowledgeBaseId: libraryId,
              parentId: folderId,
              showFilesInKnowledgeBase: false,
            }),
          {
            revalidate: false, // Don't revalidate immediately after mutation
          },
        );

        if (!response || !response.items) {
          console.error('Failed to load folder contents: no data returned');
          return;
        }

        const childItems: TreeItem[] = response.items.map((item) => ({
          fileType: item.fileType,
          id: item.id,
          isFolder: item.fileType === 'custom/folder',
          name: item.name,
          slug: item.slug,
          sourceType: item.sourceType,
          url: item.url,
        }));

        // Sort children: folders first, then files
        const sortedChildren = sortItems(childItems);

        // Store children in cache
        state.folderChildrenCache.set(folderId, sortedChildren);
        state.loadedFolders.add(folderId);
      } catch (error) {
        console.error('Failed to load folder contents:', error);
      } finally {
        // Clear loading state
        state.loadingFolders.delete(folderId);
        // Trigger re-render
        forceUpdate();
      }
    },
    [libraryId, sortItems, state, forceUpdate],
  );

  const handleToggleFolder = useCallback(
    (folderId: string) => {
      if (state.expandedFolders.has(folderId)) {
        state.expandedFolders.delete(folderId);
      } else {
        state.expandedFolders.add(folderId);
      }
      // Trigger re-render
      forceUpdate();
    },
    [state, forceUpdate],
  );

  // Reset parent folder key when switching libraries
  useEffect(() => {
    parentFolderKeyRef.current = null;
  }, [libraryId]);

  // Listen for external tree refresh events (triggered when cache is cleared)
  useEffect(() => {
    if (typeof window === 'undefined') return;

    const handleTreeRefresh = (event: Event) => {
      const detail = (event as CustomEvent<{ knowledgeBaseId?: string }>).detail;
      if (detail?.knowledgeBaseId && libraryId && detail.knowledgeBaseId !== libraryId) return;
      forceUpdate();
    };

    window.addEventListener(TREE_REFRESH_EVENT, handleTreeRefresh);
    return () => {
      window.removeEventListener(TREE_REFRESH_EVENT, handleTreeRefresh);
    };
  }, [libraryId, forceUpdate]);

  // Auto-expand folders when navigating to a folder in Explorer
  useEffect(() => {
    if (!folderBreadcrumb || folderBreadcrumb.length === 0) return;

    let hasChanges = false;

    // Expand all folders in the breadcrumb path
    for (const crumb of folderBreadcrumb) {
      const key = crumb.slug || crumb.id;
      if (!state.expandedFolders.has(key)) {
        state.expandedFolders.add(key);
        hasChanges = true;
      }

      // Load folder contents if not already loaded
      if (!state.loadedFolders.has(key) && !state.loadingFolders.has(key)) {
        handleLoadFolder(key);
      }
    }

    if (hasChanges) {
      forceUpdate();
    }
  }, [folderBreadcrumb, state, forceUpdate, handleLoadFolder]);

  // Auto-expand parent folder when viewing a file
  useEffect(() => {
    if (!currentFile || !currentViewItemId) {
      parentFolderKeyRef.current = null;
      return;
    }

    // If the file has a parent folder, expand the path to it
    if (currentFile.parentId) {
      // Fetch the parent folder's breadcrumb to get the full path
      const fetchParentPath = async () => {
        try {
          const parentBreadcrumb = await fileService.getFolderBreadcrumb(currentFile.parentId!);

          if (!parentBreadcrumb || parentBreadcrumb.length === 0) return;

          let hasChanges = false;

          // The last item in breadcrumb is the immediate parent folder
          const parentFolder = parentBreadcrumb.at(-1)!;
          const parentKey = parentFolder.slug || parentFolder.id;
          parentFolderKeyRef.current = parentKey;

          // Expand all folders in the parent's breadcrumb path
          for (const crumb of parentBreadcrumb) {
            const key = crumb.slug || crumb.id;
            if (!state.expandedFolders.has(key)) {
              state.expandedFolders.add(key);
              hasChanges = true;
            }

            // Load folder contents if not already loaded
            if (!state.loadedFolders.has(key) && !state.loadingFolders.has(key)) {
              handleLoadFolder(key);
            }
          }

          if (hasChanges) {
            forceUpdate();
          }
        } catch (error) {
          console.error('Failed to fetch parent folder breadcrumb:', error);
        }
      };

      fetchParentPath();
    } else {
      parentFolderKeyRef.current = null;
    }
  }, [currentFile, currentViewItemId, state, forceUpdate, handleLoadFolder]);

  if (isLoading) {
    return <TreeSkeleton />;
  }

  // Determine which item should be highlighted
  // If viewing a file, highlight its parent folder
  // Otherwise, highlight the current folder
  const selectedKey =
    currentViewItemId && parentFolderKeyRef.current
      ? parentFolderKeyRef.current
      : currentFolderSlug;

  return (
    <Flexbox paddingInline={4} style={{ height: '100%' }}>
      <VList
        bufferSize={typeof window !== 'undefined' ? window.innerHeight : 0}
        style={{ height: '100%' }}
      >
        {visibleNodes.map(({ item, key, level }) => (
          <div key={key} style={{ paddingBottom: 2 }}>
            <HierarchyNode
              expandedFolders={expandedFolders}
              folderChildrenCache={folderChildrenCache}
              item={item}
              level={level}
              loadingFolders={loadingFolders}
              onLoadFolder={handleLoadFolder}
              onToggleFolder={handleToggleFolder}
              selectedKey={selectedKey}
              updateKey={updateKey}
            />
          </div>
        ))}
      </VList>
    </Flexbox>
  );
});

LibraryHierarchy.displayName = 'FileTree';

export default LibraryHierarchy;

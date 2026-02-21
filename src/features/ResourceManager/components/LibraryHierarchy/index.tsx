'use client';

import { Flexbox } from '@lobehub/ui';
import { memo, useCallback, useEffect, useMemo, useReducer, useRef } from 'react';
import { VList } from 'virtua';

import { useFolderPath } from '@/app/[variants]/(main)/resource/features/hooks/useFolderPath';
import { useResourceManagerStore } from '@/app/[variants]/(main)/resource/features/store';
import { fileService } from '@/services/file';
import { useFileStore } from '@/store/file';
import { type ResourceQueryParams } from '@/types/resource';

import { HierarchyNode } from './HierarchyNode';
import TreeSkeleton from './TreeSkeleton';
import {
  getTreeState,
  resourceItemToTreeItem,
  sortTreeItems,
  TREE_REFRESH_EVENT,
} from './treeState';
import { type TreeItem } from './types';

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

  const [resourceList, resourceQueryParams] = useFileStore((s) => [s.resourceList, s.queryParams]);

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

  const isExplorerCacheActiveForTree = useMemo(() => {
    if (!libraryId) return false;
    if (!resourceQueryParams) return false;

    // We intentionally ignore search per requirement: tree always shows full hierarchy
    if (resourceQueryParams.q) return false;

    return resourceQueryParams.libraryId === libraryId;
  }, [libraryId, resourceQueryParams]);

  const explorerParentKey = useMemo(() => {
    if (!isExplorerCacheActiveForTree) return null;
    return (resourceQueryParams as ResourceQueryParams).parentId ?? null;
  }, [isExplorerCacheActiveForTree, resourceQueryParams]);

  const explorerChildren = useMemo(() => {
    if (!isExplorerCacheActiveForTree) return [];
    return sortTreeItems(resourceList.map(resourceItemToTreeItem));
  }, [isExplorerCacheActiveForTree, resourceList]);

  const isSameTreeItems = useCallback((a: TreeItem[] | undefined, b: TreeItem[]) => {
    if (!a) return false;
    if (a.length !== b.length) return false;
    // Compare minimal stable identity for change detection
    let i = 0;
    for (const item of a) {
      if (item.id !== b[i]?.id) return false;
      i += 1;
    }
    return true;
  }, []);

  // Convert root data to tree items
  const items: TreeItem[] = useMemo(() => {
    // If Explorer has loaded root for this library, use its cache to ensure identical state
    if (isExplorerCacheActiveForTree && explorerParentKey === null) return explorerChildren;
    if (!rootData) return [];

    const mappedItems: TreeItem[] = rootData.map((item) => ({
      fileType: item.fileType,
      id: item.id,
      isFolder: item.fileType === 'custom/folder',
      metadata: item.metadata ?? undefined,
      name: item.name,
      slug: item.slug,
      sourceType: item.sourceType,
      url: item.url,
    }));

    return sortTreeItems(mappedItems);
  }, [explorerChildren, explorerParentKey, rootData, updateKey]);

  // Hydrate tree cache for the folder Explorer has loaded (non-root only).
  // This ensures the tree and explorer render identical children for that folder.
  useEffect(() => {
    if (!isExplorerCacheActiveForTree) return;
    if (!explorerParentKey) return; // root handled via `items` memo above

    const existing = state.folderChildrenCache.get(explorerParentKey);
    if (isSameTreeItems(existing, explorerChildren)) return;

    state.folderChildrenCache.set(explorerParentKey, explorerChildren);
    state.loadedFolders.add(explorerParentKey);
    forceUpdate();
    // NOTE: folderChildrenCache / loadedFolders are mutated in-place
  }, [
    explorerChildren,
    explorerParentKey,
    isExplorerCacheActiveForTree,
    isSameTreeItems,
    state,
    forceUpdate,
  ]);

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
        // Prefer Explorer's cache when it matches this folder (keeps tree + explorer identical)
        if (isExplorerCacheActiveForTree && explorerParentKey === folderId) {
          state.folderChildrenCache.set(folderId, explorerChildren);
          state.loadedFolders.add(folderId);
          return;
        }

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
          metadata: item.metadata ?? undefined,
          name: item.name,
          slug: item.slug,
          sourceType: item.sourceType,
          url: item.url,
        }));

        // Sort children: folders first, then files
        const sortedChildren = sortTreeItems(childItems);

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
    [
      explorerChildren,
      explorerParentKey,
      forceUpdate,
      isExplorerCacheActiveForTree,
      libraryId,
      state,
    ],
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
              selectedKey={selectedKey}
              updateKey={updateKey}
              onLoadFolder={handleLoadFolder}
              onToggleFolder={handleToggleFolder}
            />
          </div>
        ))}
      </VList>
    </Flexbox>
  );
});

LibraryHierarchy.displayName = 'FileTree';

export default LibraryHierarchy;

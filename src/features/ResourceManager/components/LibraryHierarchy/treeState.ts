import { fileService } from '@/services/file';
import { useFileStore } from '@/store/file';
import { type ResourceItem } from '@/types/resource';

import { type TreeItem } from './types';

export const sortTreeItems = <T extends TreeItem>(items: T[]): T[] => {
  return [...items].sort((a, b) => {
    // Folders first
    if (a.isFolder && !b.isFolder) return -1;
    if (!a.isFolder && b.isFolder) return 1;
    // Then alphabetically by name
    return a.name.localeCompare(b.name);
  });
};

export const resourceItemToTreeItem = (item: ResourceItem): TreeItem => {
  return {
    fileType: item.fileType,
    id: item.id,
    isFolder: item.fileType === 'custom/folder',
    metadata: item.metadata,
    name: item.name,
    slug: item.slug,
    sourceType: item.sourceType,
    url: item.url || '',
  };
};

// Module-level state to persist expansion across re-renders
const treeState = new Map<
  string,
  {
    expandedFolders: Set<string>;
    folderChildrenCache: Map<string, TreeItem[]>;
    loadedFolders: Set<string>;
    loadingFolders: Set<string>;
  }
>();

export const TREE_REFRESH_EVENT = 'resource-tree-refresh';

export const emitTreeRefresh = (knowledgeBaseId: string) => {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(
    new CustomEvent(TREE_REFRESH_EVENT, {
      detail: { knowledgeBaseId },
    }),
  );
};

export const getTreeState = (knowledgeBaseId: string) => {
  if (!treeState.has(knowledgeBaseId)) {
    treeState.set(knowledgeBaseId, {
      expandedFolders: new Set(),
      folderChildrenCache: new Map(),
      loadedFolders: new Set(),
      loadingFolders: new Set(),
    });
  }
  return treeState.get(knowledgeBaseId)!;
};

/**
 * Clear and reload all expanded folders
 * This should be called along with file store's refreshFileList()
 * Simpler approach: reload all expanded folders to avoid ID vs slug issues
 */
export const clearTreeFolderCache = async (knowledgeBaseId: string) => {
  const state = treeState.get(knowledgeBaseId);
  if (!state) return;

  const { resourceList } = useFileStore.getState();

  const resolveParentId = (key: string | null | undefined) => {
    if (!key) return null;
    // Prefer id match
    const byId = resourceList.find(
      (item) => item.knowledgeBaseId === knowledgeBaseId && item.id === key,
    );
    if (byId) return byId.id;
    // Fallback to slug match
    const bySlug = resourceList.find(
      (item) => item.knowledgeBaseId === knowledgeBaseId && item.slug === key,
    );
    return bySlug?.id ?? key;
  };

  const buildChildrenFromStore = (parentKey: string | null) => {
    const parentId = resolveParentId(parentKey);
    const items = resourceList
      .filter(
        (item) =>
          item.knowledgeBaseId === knowledgeBaseId &&
          (item.parentId ?? null) === (parentId ?? null),
      )
      .map(resourceItemToTreeItem);

    return sortTreeItems(items);
  };

  // Get list of all currently expanded folders before clearing
  const expandedFoldersList = Array.from(state.expandedFolders);

  // Clear all caches
  state.folderChildrenCache.clear();
  state.loadedFolders.clear();

  // Reload each expanded folder
  for (const folderKey of expandedFoldersList) {
    // Prefer local store (explorer data) to avoid stale remote state
    const localChildren = buildChildrenFromStore(folderKey);
    if (localChildren.length > 0) {
      state.folderChildrenCache.set(folderKey, localChildren);
      state.loadedFolders.add(folderKey);
      continue;
    }

    // Fallback to remote fetch if store has no data (e.g., initial load)
    try {
      const response = await fileService.getKnowledgeItems({
        knowledgeBaseId,
        parentId: folderKey,
        showFilesInKnowledgeBase: false,
      });

      if (response?.items) {
        const childItems = response.items.map((item) => ({
          fileType: item.fileType,
          id: item.id,
          isFolder: item.fileType === 'custom/folder',
          metadata: item.metadata,
          name: item.name,
          slug: item.slug,
          sourceType: item.sourceType,
          url: item.url,
        }));

        // Sort children: folders first, then files
        const sortedChildren = childItems.sort((a, b) => {
          if (a.isFolder && !b.isFolder) return -1;
          if (!a.isFolder && b.isFolder) return 1;
          return a.name.localeCompare(b.name);
        });

        state.folderChildrenCache.set(folderKey, sortedChildren);
        state.loadedFolders.add(folderKey);
      }
    } catch (error) {
      console.error(`Failed to reload folder ${folderKey}:`, error);
    }
  }

  // Revalidate SWR caches for root and expanded folders to keep list and tree in sync
  try {
    const { mutate } = await import('swr');
    const revalidateFolder = (parentId: string | null) =>
      mutate(
        [
          'useFetchKnowledgeItems',
          {
            knowledgeBaseId,
            parentId,
            showFilesInKnowledgeBase: false,
          },
        ],
        undefined,
        { revalidate: true },
      );

    await Promise.all([
      revalidateFolder(null),
      ...expandedFoldersList.map((folderKey) => revalidateFolder(folderKey)),
    ]);
  } catch (error) {
    console.error('Failed to revalidate tree SWR cache:', error);
  }

  emitTreeRefresh(knowledgeBaseId);
};

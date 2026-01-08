'use client';

import { CaretDownFilled, LoadingOutlined } from '@ant-design/icons';
import { ActionIcon, Block, Flexbox, Icon, showContextMenu } from '@lobehub/ui';
import { App, Input } from 'antd';
import { createStaticStyles, cx } from 'antd-style';
import { FileText, FolderIcon, FolderOpenIcon } from 'lucide-react';
import * as motion from 'motion/react-m';
import React, { memo, useCallback, useMemo, useReducer, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { VList } from 'virtua';

import {
  getTransparentDragImage,
  useDragActive,
  useDragState,
} from '@/app/[variants]/(main)/resource/features/DndContextWrapper';
import { useFolderPath } from '@/app/[variants]/(main)/resource/features/hooks/useFolderPath';
import { useResourceManagerStore } from '@/app/[variants]/(main)/resource/features/store';
import FileIcon from '@/components/FileIcon';
import { fileService } from '@/services/file';
import { useFileStore } from '@/store/file';
import type { ResourceItem } from '@/types/resource';

import { useFileItemDropdown } from '../Explorer/ItemDropdown/useFileItemDropdown';
import TreeSkeleton from './TreeSkeleton';

// Module-level state to persist expansion across re-renders
const treeState = new Map<
  string,
  {
    expandedFolders: Set<string>;
    folderChildrenCache: Map<string, any[]>;
    loadedFolders: Set<string>;
    loadingFolders: Set<string>;
  }
>();

const TREE_REFRESH_EVENT = 'resource-tree-refresh';

const emitTreeRefresh = (knowledgeBaseId: string) => {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(
    new CustomEvent(TREE_REFRESH_EVENT, {
      detail: { knowledgeBaseId },
    }),
  );
};

const getTreeState = (knowledgeBaseId: string) => {
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
    return resourceList
      .filter(
        (item) =>
          item.knowledgeBaseId === knowledgeBaseId &&
          (item.parentId ?? null) === (parentId ?? null),
      )
      .map<ResourceItem>((item) => item)
      .map((item) => ({
        fileType: item.fileType,
        id: item.id,
        isFolder: item.fileType === 'custom/folder',
        name: item.name,
        slug: item.slug,
        sourceType: item.sourceType,
        url: item.url || '',
      }))
      .sort((a, b) => {
        if (a.isFolder && !b.isFolder) return -1;
        if (!a.isFolder && b.isFolder) return 1;
        return a.name.localeCompare(b.name);
      });
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

const styles = createStaticStyles(({ css, cssVar }) => ({
  dragging: css`
    will-change: transform;
    opacity: 0.5;
  `,
  fileItemDragOver: css`
    color: ${cssVar.colorBgElevated} !important;
    background-color: ${cssVar.colorText} !important;

    * {
      color: ${cssVar.colorBgElevated} !important;
    }
  `,
  treeItem: css`
    cursor: pointer;
  `,
}));

interface TreeItem {
  children?: TreeItem[];
  fileType: string;
  id: string;
  isFolder: boolean;
  name: string;
  slug?: string | null;
  sourceType?: string;
  url: string;
}

// Row component for folder / file tree (virtualized by flattening visible nodes)
const FileTreeRow = memo<{
  expandedFolders: Set<string>;
  folderChildrenCache: Map<string, TreeItem[]>;
  item: TreeItem;
  level?: number;
  loadingFolders: Set<string>;
  onLoadFolder: (_: string) => Promise<void>;
  onToggleFolder: (_: string) => void;
  selectedKey: string | null;
  updateKey?: number;
}>(
  ({
    item,
    level = 0,
    expandedFolders,
    loadingFolders,
    onToggleFolder,
    onLoadFolder,
    selectedKey,

    folderChildrenCache,
  }) => {
    const navigate = useNavigate();
    const { currentFolderSlug } = useFolderPath();
    const { message } = App.useApp();

    const [setMode, setCurrentViewItemId, libraryId] = useResourceManagerStore((s) => [
      s.setMode,
      s.setCurrentViewItemId,
      s.libraryId,
    ]);

    const renameFolder = useFileStore((s) => s.renameFolder);

    const [isRenaming, setIsRenaming] = useState(false);
    const [renamingValue, setRenamingValue] = useState(item.name);
    const inputRef = useRef<any>(null);

    // Memoize computed values that don't change frequently
    const { itemKey } = useMemo(
      () => ({
        itemKey: item.slug || item.id,
      }),
      [item.slug, item.id],
    );

    const handleRenameStart = useCallback(() => {
      setIsRenaming(true);
      setRenamingValue(item.name);
      // Focus input after render
      setTimeout(() => {
        inputRef.current?.focus();
        inputRef.current?.select();
      }, 0);
    }, [item.name]);

    const handleRenameConfirm = useCallback(async () => {
      if (!renamingValue.trim()) {
        message.error('Folder name cannot be empty');
        return;
      }

      if (renamingValue.trim() === item.name) {
        setIsRenaming(false);
        return;
      }

      try {
        await renameFolder(item.id, renamingValue.trim());
        if (libraryId) {
          await clearTreeFolderCache(libraryId);
        }
        message.success('Renamed successfully');
        setIsRenaming(false);
      } catch (error) {
        console.error('Rename error:', error);
        message.error('Rename failed');
      }
    }, [item.id, item.name, libraryId, renamingValue, renameFolder, message]);

    const handleRenameCancel = useCallback(() => {
      setIsRenaming(false);
      setRenamingValue(item.name);
    }, [item.name]);

    const { menuItems } = useFileItemDropdown({
      fileType: item.fileType,
      filename: item.name,
      id: item.id,
      libraryId,
      onRenameStart: item.isFolder ? handleRenameStart : undefined,
      sourceType: item.sourceType,
      url: item.url,
    });

    const isDragActive = useDragActive();
    const { setCurrentDrag } = useDragState();
    const [isDragging, setIsDragging] = useState(false);
    const [isOver, setIsOver] = useState(false);

    // Memoize drag data to prevent recreation
    const dragData = useMemo(
      () => ({
        fileType: item.fileType,
        isFolder: item.isFolder,
        name: item.name,
        sourceType: item.sourceType,
      }),
      [item.fileType, item.isFolder, item.name, item.sourceType],
    );

    // Native HTML5 drag event handlers
    const handleDragStart = useCallback(
      (e: React.DragEvent) => {
        setIsDragging(true);
        setCurrentDrag({
          data: dragData,
          id: item.id,
          type: item.isFolder ? 'folder' : 'file',
        });

        // Set drag image to be transparent (we use custom overlay)
        const img = getTransparentDragImage();
        if (img) {
          e.dataTransfer.setDragImage(img, 0, 0);
        }
        e.dataTransfer.effectAllowed = 'move';
      },
      [dragData, item.id, item.isFolder, setCurrentDrag],
    );

    const handleDragEnd = useCallback(() => {
      setIsDragging(false);
    }, []);

    const handleDragOver = useCallback(
      (e: React.DragEvent) => {
        if (!item.isFolder || !isDragActive) return;

        e.preventDefault();
        e.stopPropagation();
        setIsOver(true);
      },
      [item.isFolder, isDragActive],
    );

    const handleDragLeave = useCallback(() => {
      setIsOver(false);
    }, []);

    const handleDrop = useCallback(() => {
      // Clear the highlight after drop
      setIsOver(false);
    }, []);

    const handleItemClick = useCallback(() => {
      // Open file modal using slug-based routing
      const currentPath = currentFolderSlug
        ? `/resource/library/${libraryId}/${currentFolderSlug}`
        : `/resource/library/${libraryId}`;

      setCurrentViewItemId(itemKey);
      navigate(`${currentPath}?file=${itemKey}`);

      if (itemKey.startsWith('doc')) {
        setMode('page');
      } else {
        // Set mode to 'file' immediately to prevent flickering to list view
        setMode('editor');
      }
    }, [itemKey, currentFolderSlug, libraryId, navigate, setMode, setCurrentViewItemId]);

    const handleFolderClick = useCallback(
      (folderId: string, folderSlug?: string | null) => {
        const navKey = folderSlug || folderId;
        navigate(`/resource/library/${libraryId}/${navKey}`);

        setMode('explorer');
      },
      [libraryId, navigate],
    );

    if (item.isFolder) {
      const isExpanded = expandedFolders.has(itemKey);
      const isActive = selectedKey === itemKey;
      const isLoading = loadingFolders.has(itemKey);

      const handleToggle = async () => {
        // Toggle folder expansion
        onToggleFolder(itemKey);

        // Only load if not already cached
        if (!isExpanded && !folderChildrenCache.has(itemKey)) {
          await onLoadFolder(itemKey);
        }
      };

      return (
        <Flexbox gap={2}>
          <Block
            align={'center'}
            className={cx(
              styles.treeItem,
              isOver && styles.fileItemDragOver,
              isDragging && styles.dragging,
            )}
            clickable
            data-drop-target-id={item.id}
            data-is-folder={String(item.isFolder)}
            draggable
            gap={8}
            height={36}
            horizontal
            onClick={() => handleFolderClick(item.id, item.slug)}
            onContextMenu={(e) => {
              e.preventDefault();
              showContextMenu(menuItems());
            }}
            onDragEnd={handleDragEnd}
            onDragLeave={handleDragLeave}
            onDragOver={handleDragOver}
            onDragStart={handleDragStart}
            onDrop={handleDrop}
            paddingInline={4}
            style={{
              paddingInlineStart: level * 12 + 4,
            }}
            variant={isActive ? 'filled' : 'borderless'}
          >
            {isLoading ? (
              <ActionIcon icon={LoadingOutlined as any} size={'small'} spin style={{ width: 20 }} />
            ) : (
              <motion.div
                animate={{ rotate: isExpanded ? 0 : -90 }}
                initial={false}
                transition={{ duration: 0.2, ease: 'easeInOut' }}
              >
                <ActionIcon
                  icon={CaretDownFilled as any}
                  onClick={(e) => {
                    e.stopPropagation();
                    handleToggle();
                  }}
                  size={'small'}
                  style={{ width: 20 }}
                />
              </motion.div>
            )}
            <Flexbox
              align={'center'}
              flex={1}
              gap={8}
              horizontal
              style={{ minHeight: 28, minWidth: 0, overflow: 'hidden' }}
            >
              <Icon icon={isExpanded ? FolderOpenIcon : FolderIcon} size={18} />
              {isRenaming ? (
                <Input
                  onBlur={handleRenameConfirm}
                  onChange={(e) => setRenamingValue(e.target.value)}
                  onClick={(e) => e.stopPropagation()}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      handleRenameConfirm();
                    } else if (e.key === 'Escape') {
                      e.preventDefault();
                      handleRenameCancel();
                    }
                  }}
                  onPointerDown={(e) => e.stopPropagation()}
                  ref={inputRef}
                  size="small"
                  style={{ flex: 1 }}
                  value={renamingValue}
                />
              ) : (
                <span
                  style={{
                    flex: 1,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {item.name}
                </span>
              )}
            </Flexbox>
          </Block>
        </Flexbox>
      );
    }

    // Render as file
    const isActive = selectedKey === itemKey;
    return (
      <Flexbox gap={2}>
        <Block
          align={'center'}
          className={cx(styles.treeItem, isDragging && styles.dragging)}
          clickable
          data-drop-target-id={item.id}
          data-is-folder={false}
          draggable
          gap={8}
          height={36}
          horizontal
          onClick={handleItemClick}
          onContextMenu={(e) => {
            e.preventDefault();
            showContextMenu(menuItems());
          }}
          onDragEnd={handleDragEnd}
          onDragStart={handleDragStart}
          paddingInline={4}
          style={{
            paddingInlineStart: level * 12 + 4,
          }}
          variant={isActive ? 'filled' : 'borderless'}
        >
          <div style={{ width: 20 }} />
          <Flexbox
            align={'center'}
            flex={1}
            gap={8}
            horizontal
            style={{ minHeight: 28, minWidth: 0, overflow: 'hidden' }}
          >
            {item.sourceType === 'document' ? (
              <Icon icon={FileText} size={18} />
            ) : (
              <FileIcon fileName={item.name} fileType={item.fileType} size={18} />
            )}
            <span
              style={{
                flex: 1,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {item.name}
            </span>
          </Flexbox>
        </Block>
      </Flexbox>
    );
  },
);

FileTreeRow.displayName = 'FileTreeRow';

/**
 * As a sidebar along with the Explorer to work
 */
const FileTree = memo(() => {
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
  const state = React.useMemo(() => getTreeState(libraryId || ''), [libraryId]);
  const { expandedFolders, folderChildrenCache, loadingFolders } = state;

  // Fetch breadcrumb for current folder
  const { data: folderBreadcrumb } = useFetchFolderBreadcrumb(currentFolderSlug);

  // Fetch current file when viewing a file
  const { data: currentFile } = useFetchKnowledgeItem(currentViewItemId);

  // Track parent folder key for file selection - stored in a ref to avoid hook order issues
  const parentFolderKeyRef = React.useRef<string | null>(null);

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
  const items: TreeItem[] = React.useMemo(() => {
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

  const visibleNodes = React.useMemo(() => {
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
  React.useEffect(() => {
    parentFolderKeyRef.current = null;
  }, [libraryId]);

  // Listen for external tree refresh events (triggered when cache is cleared)
  React.useEffect(() => {
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
  React.useEffect(() => {
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
  React.useEffect(() => {
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
            <FileTreeRow
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

FileTree.displayName = 'FileTree';

export default FileTree;

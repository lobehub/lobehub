'use client';

import { Flexbox } from '@lobehub/ui';
import { App } from 'antd';
import { memo, useCallback, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useSearchParams } from 'react-router-dom';

import type { ExplorerTreeHandle, ExplorerTreeNode } from '@/features/ExplorerTree';
import { ExplorerTree } from '@/features/ExplorerTree';
import { PAGE_FILE_TYPE } from '@/features/ResourceManager/constants';
import { useCurrentDrag } from '@/routes/(main)/resource/features/DndContextWrapper';
import { useFolderPath } from '@/routes/(main)/resource/features/hooks/useFolderPath';
import { useResourceManagerStore } from '@/routes/(main)/resource/features/store';

import { bindResourceTreeBridge } from '../../tree/resourceTreeBridge';
import type { ResourceTreeNode } from '../../tree/types';
import { useResolvedResourceFolder } from '../../tree/useResolvedResourceFolder';
import { useResourceTreeController } from '../../tree/useResourceTreeController';
import { useFileItemDropdownFactory } from '../Explorer/ItemDropdown/useFileItemDropdown';
import { KnowledgeBaseListProvider } from '../KnowledgeBaseListProvider';
import TreeSkeleton from './TreeSkeleton';

const isPageNode = (node: ResourceTreeNode) => {
  const lowerFileType = node.fileType?.toLowerCase();
  const lowerName = node.name?.toLowerCase();
  const isPDF = lowerFileType === 'pdf' || lowerName?.endsWith('.pdf');
  const isOfficeFile =
    lowerName?.endsWith('.xls') ||
    lowerName?.endsWith('.xlsx') ||
    lowerName?.endsWith('.doc') ||
    lowerName?.endsWith('.docx') ||
    lowerName?.endsWith('.ppt') ||
    lowerName?.endsWith('.pptx') ||
    lowerName?.endsWith('.odt');

  return (
    !isPDF && !isOfficeFile && (node.sourceType === 'document' || node.fileType === PAGE_FILE_TYPE)
  );
};

const LibraryHierarchyTree = memo(() => {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { t } = useTranslation('components');
  const { message } = App.useApp();
  const treeRef = useRef<ExplorerTreeHandle>(null);
  const currentDrag = useCurrentDrag();
  const getFileItemDropdown = useFileItemDropdownFactory();
  const { currentFolderSlug } = useFolderPath();
  const resolvedFolder = useResolvedResourceFolder(currentFolderSlug);
  const [libraryId, selectedFileIds, setCurrentViewItemId, setMode, setSelectedFileIds] =
    useResourceManagerStore((s) => [
      s.libraryId,
      s.selectedFileIds,
      s.setCurrentViewItemId,
      s.setMode,
      s.setSelectedFileIds,
    ]);
  const {
    childrenByParentId,
    expandedIds,
    moveExternalItems,
    moveTreeItems,
    nodes,
    renameNode,
    revalidateParent,
    selectedTreeIds,
    setExpandedIds,
    setSelectedTreeIds,
    statusByParentId,
  } = useResourceTreeController({ libraryId });

  useEffect(() => {
    return bindResourceTreeBridge({
      moveExternalItems,
      revalidateParent,
    });
  }, [moveExternalItems, revalidateParent]);

  useEffect(() => {
    if (resolvedFolder.isLoading) return;

    setSelectedTreeIds(resolvedFolder.folderId ? [resolvedFolder.folderId] : []);

    if (resolvedFolder.ancestorIds.length === 0) return;

    const nextExpandedIds = new Set(expandedIds);
    let changed = false;
    for (const id of resolvedFolder.ancestorIds) {
      if (nextExpandedIds.has(id)) continue;
      nextExpandedIds.add(id);
      changed = true;
    }

    if (changed) setExpandedIds([...nextExpandedIds]);
  }, [
    expandedIds,
    resolvedFolder.ancestorIds,
    resolvedFolder.folderId,
    resolvedFolder.isLoading,
    setExpandedIds,
    setSelectedTreeIds,
  ]);

  const handleNodeClick = useCallback(
    (node: ExplorerTreeNode<ResourceTreeNode>) => {
      const item = node.data;
      if (!item || !libraryId) return;

      if (item.isFolder) {
        const folderSlug = item.slug || item.id;
        const nextParams = new URLSearchParams(searchParams);
        nextParams.delete('file');
        const queryString = nextParams.toString();
        const path = `/resource/library/${libraryId}/${folderSlug}`;

        navigate(queryString ? `${path}?${queryString}` : path);
        setMode('explorer');
        return;
      }

      setCurrentViewItemId(item.id);
      setMode(isPageNode(item) ? 'page' : 'editor');
      setSearchParams(
        (previous) => {
          const nextParams = new URLSearchParams(previous);
          nextParams.set('file', item.id);
          return nextParams;
        },
        { replace: true },
      );
    },
    [libraryId, navigate, searchParams, setCurrentViewItemId, setMode, setSearchParams],
  );

  const handleExternalDrop = useCallback(
    ({ targetNode }: { targetNode: ExplorerTreeNode<ResourceTreeNode> | null }) => {
      const target = targetNode?.data;
      if (!target?.isFolder || !currentDrag) return;

      const isDraggingSelection = selectedFileIds.includes(currentDrag.id);
      const ids = isDraggingSelection ? selectedFileIds : [currentDrag.id];
      if (ids.includes(target.id) || currentDrag.parentKey === target.id) return;

      void moveExternalItems(ids, target.id)
        .then(() => {
          message.success(t('FileManager.actions.moveSuccess'));
          if (isDraggingSelection) setSelectedFileIds([]);
        })
        .catch(() => {
          message.error(t('FileManager.actions.moveError'));
        });
    },
    [currentDrag, message, moveExternalItems, selectedFileIds, setSelectedFileIds, t],
  );

  const handleMove = useCallback(
    (sourceIds: string[], oldParentId: string | null, newParentId: string | null) => {
      void moveTreeItems(sourceIds, oldParentId, newParentId).catch(() => {
        message.error(t('FileManager.actions.moveError'));
      });
    },
    [message, moveTreeItems, t],
  );

  const isRootLoading = statusByParentId.get(null) === 'loading' && !childrenByParentId.has(null);

  if (isRootLoading) return <TreeSkeleton />;

  return (
    <Flexbox paddingInline={4} style={{ height: '100%' }}>
      <ExplorerTree<ResourceTreeNode>
        canRename={(node) => !!node.data?.isFolder}
        expandedIds={expandedIds}
        iconSet="complete"
        itemHeight={36}
        nodes={nodes}
        ref={treeRef}
        selectedIds={selectedTreeIds}
        getContextMenuItems={(node) => {
          const item = node.data;
          if (!item) return [];

          return getFileItemDropdown({
            fileType: item.fileType,
            filename: item.name,
            id: item.id,
            libraryId: libraryId ?? undefined,
            onRenameStart: item.isFolder
              ? () => treeRef.current?.startRenaming(node.id)
              : undefined,
            sourceType: item.sourceType,
            url: item.url,
          });
        }}
        onExpandedChange={setExpandedIds}
        onExternalDrop={handleExternalDrop}
        onMove={(event) => handleMove(event.sourceIds, event.oldParentId, event.newParentId)}
        onNodeClick={handleNodeClick}
        onSelectedChange={setSelectedTreeIds}
        onCommitRename={async (node, nextName) => {
          const name = nextName.trim();
          if (!name) throw new Error('Folder name cannot be empty');

          await renameNode(node.id, node.data?.parentId ?? null, name);
          message.success(t('FileManager.actions.renameSuccess'));
        }}
        onRenameError={() => {
          message.error(t('FileManager.actions.renameError'));
        }}
      />
    </Flexbox>
  );
});

LibraryHierarchyTree.displayName = 'LibraryHierarchyTree';

const LibraryHierarchy = memo(() => (
  <KnowledgeBaseListProvider>
    <LibraryHierarchyTree />
  </KnowledgeBaseListProvider>
));

LibraryHierarchy.displayName = 'LibraryHierarchy';

export default LibraryHierarchy;

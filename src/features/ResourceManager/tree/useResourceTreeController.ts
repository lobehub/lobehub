import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { fileService } from '@/services/file';
import { useFileStore } from '@/store/file';
import type { FileListItem } from '@/types/files';

import { deriveLoadedTree } from './deriveLoadedTree';
import { createResourceTreeMutations } from './mutations';
import type { ResourceTreeLoadStatus, ResourceTreeNode } from './types';

interface UseResourceTreeControllerOptions {
  libraryId?: string | null;
}

const ROOT_PARENT_ID = null;
const FOLDER_FILE_TYPE = 'custom/folder';

const sortTreeNodes = (nodes: ResourceTreeNode[]) =>
  [...nodes].sort((a, b) => {
    if (a.isFolder !== b.isFolder) return a.isFolder ? -1 : 1;
    return a.name.localeCompare(b.name);
  });

const toResourceTreeNode = (
  item: FileListItem,
  fallbackParentId: string | null,
): ResourceTreeNode => ({
  fileType: item.fileType,
  id: item.id,
  isFolder: item.fileType === FOLDER_FILE_TYPE,
  metadata: item.metadata ?? undefined,
  name: item.name,
  parentId: item.parentId ?? fallbackParentId,
  slug: item.slug,
  sourceType: item.sourceType,
  url: item.url ?? '',
});

export const useResourceTreeController = ({ libraryId }: UseResourceTreeControllerOptions) => {
  const generationRef = useRef(0);
  const [childrenByParentId, setChildrenByParentId] = useState<
    Map<string | null, ResourceTreeNode[]>
  >(() => new Map());
  const [statusByParentId, setStatusByParentId] = useState<
    Map<string | null, ResourceTreeLoadStatus>
  >(() => new Map());
  const [expandedIds, setExpandedIdsState] = useState<string[]>([]);
  const [selectedTreeIds, setSelectedTreeIds] = useState<string[]>([]);

  const loadChildren = useCallback(
    async (parentId: string | null, status: ResourceTreeLoadStatus = 'loading') => {
      if (!libraryId) return;

      const generation = generationRef.current;

      setStatusByParentId((previous) => new Map(previous).set(parentId, status));

      try {
        const response = await fileService.getKnowledgeItems({
          knowledgeBaseId: libraryId,
          parentId,
          showFilesInKnowledgeBase: false,
        });

        if (generationRef.current !== generation) return;

        const children = sortTreeNodes(
          response.items.map((item) => toResourceTreeNode(item, parentId)),
        );

        setChildrenByParentId((previous) => new Map(previous).set(parentId, children));
        setStatusByParentId((previous) => new Map(previous).set(parentId, 'idle'));
      } catch (error) {
        if (generationRef.current !== generation) return;

        console.error(`Failed to load resource tree children for ${parentId ?? 'root'}:`, error);
        setStatusByParentId((previous) => new Map(previous).set(parentId, 'error'));
      }
    },
    [libraryId],
  );

  useEffect(() => {
    generationRef.current += 1;
    setChildrenByParentId(new Map());
    setStatusByParentId(new Map());
    setExpandedIdsState([]);
    setSelectedTreeIds([]);

    if (libraryId) {
      void loadChildren(ROOT_PARENT_ID);
    }
  }, [libraryId, loadChildren]);

  const revalidateParent = useCallback(
    (parentId: string | null) => loadChildren(parentId, 'revalidating'),
    [loadChildren],
  );

  const setExpandedIds = useCallback(
    (ids: string[]) => {
      setExpandedIdsState(ids);

      const expandedIdSet = new Set(ids);
      const loadedNodes = [...childrenByParentId.values()].flat();
      const missingExpandedFolderIds = loadedNodes
        .filter(
          (node) =>
            node.isFolder &&
            expandedIdSet.has(node.id) &&
            !childrenByParentId.has(node.id) &&
            statusByParentId.get(node.id) !== 'loading',
        )
        .map((node) => node.id);

      for (const id of missingExpandedFolderIds) {
        void loadChildren(id);
      }
    },
    [childrenByParentId, loadChildren, statusByParentId],
  );

  const expandedIdSet = useMemo(() => new Set(expandedIds), [expandedIds]);

  const nodes = useMemo(
    () =>
      deriveLoadedTree({
        childrenByParentId,
        expandedIds: expandedIdSet,
      }),
    [childrenByParentId, expandedIdSet],
  );

  const mutations = useMemo(
    () =>
      createResourceTreeMutations({
        childrenByParentId,
        refreshFileList: () => useFileStore.getState().refreshFileList(),
        revalidateParent,
        setChildrenByParentId,
      }),
    [childrenByParentId, revalidateParent],
  );

  return {
    childrenByParentId,
    expandedIds,
    loadChildren,
    moveExternalItems: mutations.moveExternalItems,
    moveTreeItems: mutations.moveTreeItems,
    nodes,
    renameNode: mutations.renameNode,
    revalidateParent,
    selectedTreeIds,
    setExpandedIds,
    setSelectedTreeIds,
    statusByParentId,
  };
};

import { resourceService } from '@/services/resource';

import type { ResourceTreeNode } from './types';

const MOVE_INTO_DESCENDANT_ERROR = 'Cannot move a resource into itself or its descendant.';

export interface ResourceTreeMutationDeps {
  childrenByParentId: Map<string | null, ResourceTreeNode[]>;
  refreshFileList: () => Promise<void> | void;
  revalidateParent: (parentId: string | null) => Promise<void> | void;
  setChildrenByParentId: (next: Map<string | null, ResourceTreeNode[]>) => void;
}

const sortTreeNodes = (nodes: ResourceTreeNode[]) =>
  [...nodes].sort((a, b) => {
    if (a.isFolder !== b.isFolder) return a.isFolder ? -1 : 1;
    return a.name.localeCompare(b.name);
  });

const cloneChildrenByParentId = (
  childrenByParentId: ResourceTreeMutationDeps['childrenByParentId'],
) => new Map([...childrenByParentId].map(([parentId, children]) => [parentId, [...children]]));

const hasLoadedDescendant = (
  childrenByParentId: ResourceTreeMutationDeps['childrenByParentId'],
  ancestorId: string,
  targetId: string,
): boolean => {
  const children = childrenByParentId.get(ancestorId) ?? [];

  for (const child of children) {
    if (child.id === targetId) return true;
    if (child.isFolder && hasLoadedDescendant(childrenByParentId, child.id, targetId)) return true;
  }

  return false;
};

const assertMoveTarget = (
  childrenByParentId: ResourceTreeMutationDeps['childrenByParentId'],
  ids: string[],
  newParentId: string | null,
) => {
  if (!newParentId) return;

  for (const id of ids) {
    if (id === newParentId || hasLoadedDescendant(childrenByParentId, id, newParentId)) {
      throw new Error(MOVE_INTO_DESCENDANT_ERROR);
    }
  }
};

const runBestEffort = (tasks: Array<() => Promise<void> | void>) =>
  Promise.allSettled(tasks.map(async (task) => task()));

const revalidateAffectedParentsSettled = (
  revalidateParent: ResourceTreeMutationDeps['revalidateParent'],
  parentIds: Array<string | null>,
) => runBestEffort(parentIds.map((parentId) => () => revalidateParent(parentId)));

export const createResourceTreeMutations = (deps: ResourceTreeMutationDeps) => {
  const getAffectedParents = (oldParentId: string | null, newParentId: string | null) =>
    oldParentId === newParentId ? [oldParentId] : [oldParentId, newParentId];

  const moveTreeItems = async (
    ids: string[],
    oldParentId: string | null,
    newParentId: string | null,
  ): Promise<void> => {
    if (oldParentId === newParentId || ids.length === 0) return;

    assertMoveTarget(deps.childrenByParentId, ids, newParentId);

    const previous = deps.childrenByParentId;
    const next = cloneChildrenByParentId(previous);
    const idsSet = new Set(ids);
    const oldChildren = next.get(oldParentId);
    const movedItems = oldChildren?.filter((node) => idsSet.has(node.id)) ?? [];

    if (oldChildren) {
      next.set(
        oldParentId,
        oldChildren.filter((node) => !idsSet.has(node.id)),
      );
    }

    if (next.has(newParentId) && movedItems.length > 0) {
      next.set(
        newParentId,
        sortTreeNodes([
          ...(next.get(newParentId) ?? []),
          ...movedItems.map((node) => ({ ...node, parentId: newParentId })),
        ]),
      );
    }

    deps.setChildrenByParentId(next);

    const affectedParents = getAffectedParents(oldParentId, newParentId);

    try {
      await Promise.all(ids.map((id) => resourceService.moveResource(id, newParentId)));
    } catch (error) {
      deps.setChildrenByParentId(previous);
      await revalidateAffectedParentsSettled(deps.revalidateParent, affectedParents);
      throw error;
    }

    await revalidateAffectedParentsSettled(deps.revalidateParent, affectedParents);
  };

  const moveExternalItems = async (ids: string[], newParentId: string | null): Promise<void> => {
    if (ids.length === 0) return;

    assertMoveTarget(deps.childrenByParentId, ids, newParentId);

    await Promise.all(ids.map((id) => resourceService.moveResource(id, newParentId)));
    await runBestEffort([deps.refreshFileList, () => deps.revalidateParent(newParentId)]);
  };

  const renameNode = async (id: string, parentId: string | null, name: string): Promise<void> => {
    const previous = deps.childrenByParentId;
    const children = previous.get(parentId);

    if (children) {
      const next = cloneChildrenByParentId(previous);
      next.set(
        parentId,
        children.map((node) => (node.id === id ? { ...node, name } : node)),
      );
      deps.setChildrenByParentId(next);
    }

    try {
      await resourceService.updateResource(id, { name });
    } catch (error) {
      deps.setChildrenByParentId(previous);
      throw error;
    }

    await runBestEffort([deps.refreshFileList, () => deps.revalidateParent(parentId)]);
  };

  return {
    moveExternalItems,
    moveTreeItems,
    renameNode,
  };
};

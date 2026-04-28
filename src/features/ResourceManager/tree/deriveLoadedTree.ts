import type {
  ResourceExplorerTreeNode,
  ResourceTreeNode,
  ResourceTreeSnapshotInput,
} from './types';

const deriveNode = (
  node: ResourceTreeNode,
  childrenByParentId: ResourceTreeSnapshotInput['childrenByParentId'],
  expandedIds: ResourceTreeSnapshotInput['expandedIds'],
): ResourceExplorerTreeNode => {
  const treeNode: ResourceExplorerTreeNode = {
    data: node,
    id: node.id,
    isFolder: node.isFolder,
    name: node.name,
    parentId: node.parentId,
  };

  const children = childrenByParentId.get(node.id);
  if (node.isFolder && expandedIds.has(node.id) && children) {
    treeNode.children = children.map((child) => deriveNode(child, childrenByParentId, expandedIds));
  }

  return treeNode;
};

export const deriveLoadedTree = ({
  childrenByParentId,
  expandedIds,
}: ResourceTreeSnapshotInput): ResourceExplorerTreeNode[] =>
  (childrenByParentId.get(null) ?? []).map((node) =>
    deriveNode(node, childrenByParentId, expandedIds),
  );

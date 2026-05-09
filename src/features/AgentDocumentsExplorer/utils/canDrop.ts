import type { ExplorerTreeCanDropCtx } from '@/features/ExplorerTree';

import type { AgentDocumentItem } from '../types';
import { isManagedSkillItem, isPendingId, isSkillBundleItem } from '../types';

interface CanDropArgs {
  ctx: ExplorerTreeCanDropCtx<AgentDocumentItem>;
  parentMap: Map<string, string | null>;
}

const isAncestor = (
  ancestorId: string,
  descendantId: string,
  parentMap: Map<string, string | null>,
): boolean => {
  let cursor: string | null | undefined = parentMap.get(descendantId);
  while (cursor) {
    if (cursor === ancestorId) return true;
    cursor = parentMap.get(cursor);
  }
  return false;
};

export const canDropDocument = ({ ctx, parentMap }: CanDropArgs): boolean => {
  const { sourceIds, sourceNodes, targetId, targetNode } = ctx;
  if (sourceIds.length === 0) return false;

  // Drop target must be a folder or root
  if (targetNode && !targetNode.isFolder) return false;
  if (targetNode?.data && isSkillBundleItem(targetNode.data)) return false;

  // Pending targets have no server-side row yet — refuse the drop instead of
  // surfacing an error after the fact.
  if (targetId && isPendingId(targetId)) return false;

  for (let i = 0; i < sourceNodes.length; i += 1) {
    const node = sourceNodes[i];
    const sourceId = sourceIds[i];

    // No-op: dropping into current parent
    const currentParent = parentMap.get(sourceId) ?? null;
    if (currentParent === targetId) return false;

    // Cycle: folder cannot be dropped into itself or any descendant
    if (node.isFolder && targetId) {
      if (sourceId === targetId) return false;
      if (isAncestor(sourceId, targetId, parentMap)) return false;
    }

    // Web docs cannot move (not part of tree management)
    const data = node.data;
    if (data && data.sourceType === 'web') return false;
    if (data && isManagedSkillItem(data)) return false;
  }

  return true;
};

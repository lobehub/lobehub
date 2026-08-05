import type { IdNode, Message } from '../types';

/**
 * BranchResolver - Handles branch resolution logic
 *
 * Determines which branch should be active based on:
 * 1. metadata.activeBranchIndex (explicit index)
 * 2. The branch containing the latest user turn
 * 3. Inferred from which branch has children
 * 4. Default to first branch
 */
export class BranchResolver {
  constructor(private messageMap?: Map<string, Message>) {}

  /**
   * Return the canonical child order used by persisted `activeBranchIndex` metadata.
   * Tool results are inline members of an assistant turn, so branch controls never
   * count them as selectable siblings.
   */
  getMetadataBranchIds(childIds: string[]): string[] {
    return childIds.filter((id) => this.messageMap?.get(id)?.role !== 'tool');
  }

  /**
   * Get active branch ID from IdNode structure (used in contextTree building)
   * Returns undefined for optimistic updates when the branch hasn't been created yet
   */
  getActiveBranchId(message: Message, idNode: IdNode): string | undefined {
    // Priority 1: Try to get from metadata.activeBranchIndex (index-based)
    const activeBranchIndex = (message.metadata as any)?.activeBranchIndex;
    if (typeof activeBranchIndex === 'number' && activeBranchIndex >= 0) {
      // If index is within bounds, return the branch at that index
      if (activeBranchIndex < idNode.children.length) {
        return idNode.children[activeBranchIndex].id;
      }
      // Optimistic update: index === children.length means branch is being created
      if (activeBranchIndex === idNode.children.length) {
        return undefined;
      }
      // Invalid index (> children.length), ignore and continue to other strategies
    }

    // Priority 2: A persisted user descendant proves which historical branch the
    // user actually continued. Prefer the newest such descendant before the
    // generic "has children" fallback, which otherwise selects an older retried
    // assistant branch and can drop the current user turn from the flat history.
    const nodeMap = new Map<string, IdNode>();
    const pendingNodes = [...idNode.children];
    while (pendingNodes.length > 0) {
      const node = pendingNodes.pop()!;
      nodeMap.set(node.id, node);
      pendingNodes.push(...node.children);
    }
    const latestUserBranchId = this.findBranchContainingLatestUser(
      idNode.children.map((child) => child.id),
      (id) => nodeMap.get(id)?.children.map((child) => child.id) ?? [],
    );
    if (latestUserBranchId) return latestUserBranchId;

    // Priority 3: Infer from which branch has children
    for (const child of idNode.children) {
      if (child.children.length > 0) {
        return child.id;
      }
    }

    // Default to first branch
    return idNode.children[0].id;
  }

  /**
   * Get active branch ID from flat list (used in flatList building)
   * `metadataBranchIds` preserves the full UI branch-index space when `childIds`
   * is a filtered set of candidates owned by a specialized collector.
   * Returns undefined for optimistic updates when the branch hasn't been created yet
   */
  getActiveBranchIdFromMetadata(
    message: Message,
    childIds: string[],
    childrenMap: Map<string | null, string[]>,
    metadataBranchIds: string[] = childIds,
  ): string | undefined {
    // Priority 1: Try to get from metadata.activeBranchIndex (index-based)
    const activeBranchIndex = (message.metadata as any)?.activeBranchIndex;
    if (typeof activeBranchIndex === 'number' && activeBranchIndex >= 0) {
      // If index is within bounds, return the branch at that index
      if (activeBranchIndex < metadataBranchIds.length) {
        return metadataBranchIds[activeBranchIndex];
      }
      // Optimistic update: index === metadataBranchIds.length means branch is being created
      if (activeBranchIndex === metadataBranchIds.length) {
        return undefined;
      }
      // Invalid index (> metadataBranchIds.length), ignore and continue to other strategies
    }

    // Priority 2: Prefer the branch that the user most recently continued.
    const latestUserBranchId = this.findBranchContainingLatestUser(
      childIds,
      (id) => childrenMap.get(id) ?? [],
    );
    if (latestUserBranchId) return latestUserBranchId;

    // Priority 3: Infer from which child has descendants
    for (const childId of childIds) {
      const descendants = childrenMap.get(childId);
      if (descendants && descendants.length > 0) {
        return childId;
      }
    }

    // Default to first child
    return childIds[0];
  }

  /**
   * Find the candidate branch containing the newest persisted user descendant.
   * A user turn is a stronger active-path signal than descendant presence alone:
   * parallel tool results and retried operations can leave several old assistant
   * chains with descendants, while only the branch the user continued should
   * become the request tail. Thread replies are excluded because they do not
   * belong to the main conversation tree.
   */
  private findBranchContainingLatestUser(
    branchIds: string[],
    getChildren: (id: string) => string[],
  ): string | undefined {
    if (!this.messageMap) return;

    let latestTimestamp = Number.NEGATIVE_INFINITY;
    let selectedBranchId: string | undefined;

    for (const branchId of branchIds) {
      const pendingIds = [branchId];
      const visitedIds = new Set<string>();

      while (pendingIds.length > 0) {
        const messageId = pendingIds.pop()!;
        if (visitedIds.has(messageId)) continue;
        visitedIds.add(messageId);

        const descendant = this.messageMap.get(messageId);
        if (descendant?.threadId) continue;

        if (descendant?.role === 'user') {
          const timestamp = descendant.createdAt;
          if (timestamp > latestTimestamp) {
            latestTimestamp = timestamp;
            selectedBranchId = branchId;
          }
        }

        pendingIds.push(...getChildren(messageId));
      }
    }

    return selectedBranchId;
  }
}

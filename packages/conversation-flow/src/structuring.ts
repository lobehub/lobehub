import type { HelperMaps, IdNode } from './types';

/**
 * Phase 2: Structuring
 * Converts flat parent-child relationships into a tree structure
 * Separates main flow from threaded conversations
 *
 * @param helperMaps - Maps built in indexing phase
 * @returns Root nodes of the main conversation flow (idTree)
 */
export function buildIdTree(helperMaps: HelperMaps): IdNode[] {
  const { childrenMap, messageMap } = helperMaps;

  // Iterative build: a conversation's depth equals its length (each turn parents
  // off the previous one), so recursing per node overflows the stack on long
  // chains. Nodes are created on the way down, then filled from an explicit stack.
  const buildTree = (rootId: string): IdNode => {
    const root: IdNode = { children: [], id: rootId };
    const pending: IdNode[] = [root];

    while (pending.length > 0) {
      const node = pending.pop()!;

      // Filter children to only include those in main flow (not in threads)
      for (const childId of childrenMap.get(node.id) ?? []) {
        const child = messageMap.get(childId);
        if (!child || child.threadId) continue;

        const childNode: IdNode = { children: [], id: childId };
        node.children.push(childNode);
        pending.push(childNode);
      }
    }

    return root;
  };

  // Get root message IDs (messages with parentId = null and no threadId)
  const rootIds = childrenMap.get(null) ?? [];
  const mainFlowRootIds = rootIds.filter((id) => {
    const msg = messageMap.get(id);
    return msg && !msg.threadId;
  });

  return mainFlowRootIds.map((rootId) => buildTree(rootId));
}

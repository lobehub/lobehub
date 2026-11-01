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

  const mainFlowChildIds = (parentId: string | null) =>
    (childrenMap.get(parentId) ?? []).filter((childId) => {
      const child = messageMap.get(childId);
      return child && !child.threadId;
    });

  // Built with an explicit stack: a long topic is one parent chain thousands
  // of messages deep, which a per-message recursion would overflow.
  const roots: IdNode[] = mainFlowChildIds(null).map((id) => ({ children: [], id }));
  const stack = [...roots];
  while (stack.length > 0) {
    const node = stack.pop()!;
    for (const childId of mainFlowChildIds(node.id)) {
      const child: IdNode = { children: [], id: childId };
      node.children.push(child);
      stack.push(child);
    }
  }

  return roots;
}

import type { UIChatMessage } from '@lobechat/types';

export interface BranchSwitch {
  branchIndex: number;
  /** The branch child to activate; `switchMessageBranch` stores the index on its parent. */
  messageId: string;
}

/**
 * The branch switches that put `targetId` on the displayed path, outermost
 * fork first. A deep link can point at a regenerated reply the user moved away
 * from: the row is loaded, but the conversation only renders each fork's
 * active branch. Siblings are counted the way `conversation-flow` counts
 * persisted branch indexes: non-tool children of the parent, in loaded order.
 */
export const findBranchSwitchesToMessage = (
  messages: UIChatMessage[],
  targetId: string,
): BranchSwitch[] => {
  const byId = new Map(messages.map((message) => [message.id, message]));
  const branchIdsByParent = new Map<string, string[]>();
  for (const message of messages) {
    if (!message.parentId || message.role === 'tool') continue;
    const siblings = branchIdsByParent.get(message.parentId);
    if (siblings) siblings.push(message.id);
    else branchIdsByParent.set(message.parentId, [message.id]);
  }

  const switches: BranchSwitch[] = [];
  const visited = new Set<string>();
  for (let child = byId.get(targetId); child?.parentId && !visited.has(child.id);) {
    visited.add(child.id);
    const parent = byId.get(child.parentId);
    if (!parent) break;

    const branchIds = branchIdsByParent.get(parent.id) ?? [];
    const branchIndex = branchIds.indexOf(child.id);
    if (
      branchIds.length > 1 &&
      branchIndex !== -1 &&
      parent.metadata?.activeBranchIndex !== branchIndex
    )
      switches.unshift({ branchIndex, messageId: child.id });

    child = parent;
  }

  return switches;
};

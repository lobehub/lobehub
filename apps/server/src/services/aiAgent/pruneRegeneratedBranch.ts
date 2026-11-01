/**
 * Raw parent/group links for the full message tree of a topic, including
 * messages hidden inside MessageGroups. See `MessageModel.queryTopicMessageTree`.
 */
export interface MessageTreeRow {
  id: string;
  messageGroupId: string | null;
  parentId: string | null;
}

interface HistoryItemLike {
  id: string;
  role?: string;
}

/**
 * Prune the regenerate anchor's old answer branch from server-rebuilt history.
 *
 * In gateway/server-runtime mode a regenerate only sends `parentMessageId` (the
 * user message being regenerated) and the server rebuilds the LLM context from a
 * flat topic query. That query still contains the anchor's *previous* assistant
 * branch (the answer being replaced) and — for a middle-turn regenerate — the
 * later turns that continued from it. Leaving them in makes the model "continue"
 * an already-answered turn (`[U1, A1]` → continue) instead of producing a fresh
 * answer (`[U1]` → A2).
 *
 * The branch must be pruned even after `/compact`: compaction hides the grouped
 * messages and the query returns a synthetic `compressedGroup` node that carries
 * no `parentId` (and compaction never sets the group's `parentMessageId`), so
 * ancestry can't be walked from the query output alone. `tree` supplies the raw
 * links for the whole topic (including hidden/compacted messages); we compute
 * the anchor's descendants from it, then drop both regular descendant messages
 * and any group node whose members fall on that branch. Prior-turn groups (not
 * descended from the anchor) are kept.
 *
 * @param history - the rebuilt history items (may include `compressedGroup` /
 *   `compareGroup` synthetic nodes whose `id` is a group id)
 * @param tree - raw `id → parentId / messageGroupId` links for the whole topic
 * @param anchorId - the regenerate anchor (the user message id)
 */
export const pruneRegeneratedBranch = <T extends HistoryItemLike>(
  history: T[],
  tree: MessageTreeRow[],
  anchorId: string,
): T[] => {
  const parentOf = new Map(tree.map((row) => [row.id, row.parentId]));

  const descendsFromAnchor = (id: string | null | undefined): boolean => {
    let cursor = id ? parentOf.get(id) : undefined;
    const seen = new Set<string>();
    while (cursor && !seen.has(cursor)) {
      if (cursor === anchorId) return true;
      seen.add(cursor);
      cursor = parentOf.get(cursor);
    }
    return false;
  };

  // Message ids on the anchor's old branch (old answer + later turns),
  // including messages hidden inside compaction groups.
  const descendantIds = new Set(
    tree.filter((row) => descendsFromAnchor(row.id)).map((row) => row.id),
  );

  // Group nodes whose members fall on that branch (e.g. a compacted old branch).
  const prunedGroupIds = new Set(
    tree
      .filter((row) => row.messageGroupId && descendantIds.has(row.id))
      .map((row) => row.messageGroupId as string),
  );

  return history.filter((msg) => {
    if (msg.id === anchorId) return true;
    // Synthetic MessageGroup nodes carry the group id, not a message id.
    if (msg.role === 'compressedGroup' || msg.role === 'compareGroup') {
      return !prunedGroupIds.has(msg.id);
    }
    return !descendantIds.has(msg.id);
  });
};

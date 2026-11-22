import type { TopicOpenedBy } from '@lobechat/types';

/** A sub-topic as the sidebar draws it under its opener. */
export interface SubTopicNode {
  agent?: { avatar?: null | string; backgroundColor?: null | string; title?: null | string };
  agentId?: null | string;
  id: string;
  openedBy?: TopicOpenedBy | null;
  runStartedAt?: Date | null | string;
  state: 'archived' | 'failed' | 'idle' | 'running' | 'waiting_for_user';
  status?: null | string;
  /** The task a task-run sub-topic belongs to. */
  taskId?: null | string;
  title?: null | string;
  trigger?: null | string;
}

export interface SubTopicTree {
  /** Rows nested under each top-level opener, in the order they arrived. */
  childrenByRoot: Record<string, SubTopicNode[]>;
  /** List rows that render nested instead of at the top level. */
  nestedIds: Set<string>;
}

const openerOf = (openedBy: TopicOpenedBy | null | undefined) =>
  openedBy?.topicId && !openedBy.detachedAt ? openedBy.topicId : undefined;

/**
 * The sidebar's one-level hierarchy.
 *
 * - A sub-topic nests under the TOPMOST ancestor that is a top-level row of
 *   this list, so A → B → C draws as A with B and C beneath it.
 * - A sub-topic whose opener is not in the list (archived, another agent's,
 *   past the page, gone) keeps its own top-level row — nothing disappears.
 * - Cycles degrade to top-level rows.
 *
 * `listRows` are the list's own rows (with their `metadata.openedBy`);
 * `fetched` are the sub-topics the server found under them, some of which
 * may also be list rows.
 */
export const buildSubTopicTree = (
  listRows: { id: string; openedBy?: TopicOpenedBy | null }[],
  fetched: SubTopicNode[],
): SubTopicTree => {
  const openerById = new Map<string, string | undefined>();
  for (const row of listRows) openerById.set(row.id, openerOf(row.openedBy));
  for (const node of fetched) openerById.set(node.id, openerOf(node.openedBy));

  const listIds = new Set(listRows.map((row) => row.id));

  /** The topmost list row up the opener chain, or undefined when the chain leaves the list. */
  const rootOf = (id: string): string | undefined => {
    const seen = new Set([id]);
    let cursor = openerById.get(id);
    let root: string | undefined;
    while (cursor && !seen.has(cursor)) {
      seen.add(cursor);
      if (listIds.has(cursor)) root = cursor;
      if (!openerById.has(cursor)) break;
      cursor = openerById.get(cursor);
    }
    return root;
  };

  const nodesById = new Map<string, SubTopicNode>();
  for (const node of fetched) nodesById.set(node.id, node);

  const childrenByRoot: Record<string, SubTopicNode[]> = {};
  const nestedIds = new Set<string>();
  const candidates = [...new Set([...listIds, ...nodesById.keys()])];

  for (const id of candidates) {
    const root = rootOf(id);
    if (!root || root === id) continue;
    // Only a row that itself stays top-level may host others; this is what
    // turns a cycle (A opened B, B opened A) into two top-level rows.
    if (rootOf(root)) continue;
    const node = nodesById.get(id);
    if (!node) continue;
    (childrenByRoot[root] ??= []).push(node);
    if (listIds.has(id)) nestedIds.add(id);
  }

  return { childrenByRoot, nestedIds };
};

/** "Running / needs you" roll-up for a collapsed opener row. */
export const summarizeSubTopics = (nodes: SubTopicNode[]) => ({
  failed: nodes.filter((node) => node.state === 'failed').length,
  running: nodes.filter((node) => node.state === 'running').length,
  waiting: nodes.filter((node) => node.state === 'waiting_for_user').length,
});

/** A sub-topic that is running or waiting for the user — what the sidebar keeps polling for. */
export const isInFlight = (node: { state?: string }) =>
  node.state === 'running' || node.state === 'waiting_for_user';

/** The topic status the collapsed roll-up counts a sub-topic under. */
export const toRollupStatus = (state: SubTopicNode['state']) =>
  state === 'running'
    ? 'running'
    : state === 'waiting_for_user'
      ? 'waitingForHuman'
      : state === 'failed'
        ? 'failed'
        : 'active';

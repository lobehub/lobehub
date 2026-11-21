import type {
  OpenedSubTopic,
  SubTopicDetachResult,
  SubTopicMove,
  SubTopicRetireResult,
} from '@lobechat/types';

import { createReplicaSlice, recordLens, type ReplicaSyncResult } from '@/libs/replica';
import { topicService } from '@/services/topic';
import type { ChatStore } from '@/store/chat/store';
import type { StoreSetter } from '@/store/types';
import { setNamespace } from '@/utils/storeDebug';

import { subTopicTreeKey, subTopicTreeResource } from './projection';

const MAX_REFRESHED_VIEWS = 4;
const SUB_TOPIC_POLL_INTERVAL = 10_000;

const n = setNamespace('subTopic');

type Setter = StoreSetter<ChatStore>;

/** A sub-topic that moved to the top level, and whose list it went back to. */
const toMove = (row: OpenedSubTopic): SubTopicMove => ({
  agentId: row.agentId,
  agentTitle: row.agent?.title ?? null,
  id: row.id,
  // Another agent's sub-topic goes back to that agent's own list.
  movedToOwnAgent: !!row.agentId && row.agentId !== row.openedBy?.agentId,
  trigger: row.trigger,
});

/**
 * What an "archive / delete all" takes along — the server's rule
 * (`retirableDescendants`): every descendant except task runs and what they opened.
 */
export const retirableSubTopics = (rootId: string, rows: OpenedSubTopic[]) => {
  const kept = new Set<string>([rootId]);
  const result: OpenedSubTopic[] = [];
  let pending = rows;
  while (pending.length > 0) {
    const next: OpenedSubTopic[] = [];
    for (const row of pending) {
      const parent = row.openedBy?.topicId;
      if (!parent || !kept.has(parent)) {
        next.push(row);
        continue;
      }
      if (row.trigger === 'task') continue;
      kept.add(row.id);
      result.push(row);
    }
    if (next.length === pending.length) break;
    pending = next;
  }
  return result;
};

export class ChatSubTopicActionImpl {
  readonly #get: () => ChatStore;
  readonly #tree;
  /** The opener sets on screen (sidebar page, Overview), so a write refreshes exactly those. */
  readonly #mounted = new Map<string, string[]>();

  constructor(set: Setter, get: () => ChatStore, _api?: unknown) {
    void _api;
    this.#get = get;
    this.#tree = createReplicaSlice(subTopicTreeResource, {
      actionPrefix: n('tree'),
      fetcher: (openerTopicIds) => topicService.listChildTopics(openerTopicIds),
      get,
      set,
      stateKey: 'subTopicTreeReplica',
      view: recordLens<ChatStore, any>('subTopicTreeMap'),
    });
  }

  /**
   * The sub-topics under the sidebar's visible openers. Read the result
   * with `subTopicSelectors.treeOf(openerTopicIds)`.
   */
  useFetchSubTopics = (
    enabled: boolean,
    openerTopicIds: string[],
    /** Poll while a sub-topic is in flight: its runs happen on the server, out of this client's sight. */
    watch = false,
  ): ReplicaSyncResult => {
    if (enabled && openerTopicIds.length > 0) {
      const key = subTopicTreeKey(openerTopicIds);
      this.#mounted.delete(key);
      this.#mounted.set(key, openerTopicIds);
      // Only the most recent views matter; older pages are gone from the screen.
      while (this.#mounted.size > MAX_REFRESHED_VIEWS) {
        this.#mounted.delete(this.#mounted.keys().next().value!);
      }
    }
    return this.#tree.useSync(openerTopicIds, {
      enabled: enabled && openerTopicIds.length > 0,
      refreshInterval: watch ? SUB_TOPIC_POLL_INTERVAL : 0,
    });
  };

  /** Re-read the hierarchy on screen after a sub-topic moved, opened or retired. */
  refreshSubTopics = async (): Promise<void> => {
    await Promise.all(
      [...this.#mounted.values()].map((openers) =>
        this.#tree.fetch(openers, { fresh: true }).catch(() => undefined),
      ),
    );
  };

  /**
   * Archive or trash a topic with sub-topics: `all` stops and retires every
   * descendant too; `self` retires only this one and moves its sub-topics to
   * the top level. Refreshes the topic list and the hierarchy afterwards.
   */
  retireTopicTree = async (
    topicId: string,
    action: 'archive' | 'trash',
    mode: 'all' | 'self',
    options: { removeFiles?: boolean } = {},
  ): Promise<SubTopicRetireResult> => {
    // What this touches, read fresh: the moves to announce, the topics retired.
    const tree = await topicService.listChildTopics([topicId]);
    const childTopics = mode === 'all' ? 'all' : 'detach';
    if (action === 'archive') await topicService.archiveTopicTree(topicId, childTopics);
    else await topicService.removeTopicTree(topicId, childTopics, options.removeFiles);
    const result: SubTopicRetireResult =
      mode === 'all'
        ? {
            detached: [],
            retired: [...retirableSubTopics(topicId, tree).map((row) => row.id), topicId],
          }
        : {
            detached: tree.filter((row) => row.openedBy?.topicId === topicId).map(toMove),
            retired: [topicId],
          };
    // Whatever was retired — the topic or, with "all", one of its sub-topics —
    // must not stay the open conversation.
    const activeTopicId = this.#get().activeTopicId;
    if (activeTopicId && result.retired.includes(activeTopicId)) this.#get().switchTopic(null);
    await Promise.all([this.#get().refreshTopic(), this.refreshSubTopics()]);
    return result;
  };

  /** Move sub-topics to the top level. */
  detachSubTopics = async (topicIds: string[]): Promise<SubTopicDetachResult> => {
    const known = Object.values(this.#get().subTopicTreeMap).flat();
    const detached: SubTopicMove[] = [];
    for (const id of topicIds) {
      await topicService.detachFromParent(id);
      const row = known.find((item) => item.id === id);
      if (row) detached.push(toMove(row));
    }
    await Promise.all([this.#get().refreshTopic(), this.refreshSubTopics()]);
    return { detached };
  };
}

export type ChatSubTopicAction = Pick<
  ChatSubTopicActionImpl,
  'detachSubTopics' | 'refreshSubTopics' | 'retireTopicTree' | 'useFetchSubTopics'
>;

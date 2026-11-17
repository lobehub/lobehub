import { createReplicaSlice, recordLens, type ReplicaSyncResult } from '@/libs/replica';
import {
  type SubTopicDetachResult,
  type SubTopicRetireResult,
  subTopicService,
} from '@/services/subTopic';
import type { ChatStore } from '@/store/chat/store';
import type { StoreSetter } from '@/store/types';
import { setNamespace } from '@/utils/storeDebug';

import { subTopicTreeKey, subTopicTreeResource } from './projection';

const MAX_REFRESHED_VIEWS = 4;
const SUB_TOPIC_POLL_INTERVAL = 10_000;

const n = setNamespace('subTopic');

type Setter = StoreSetter<ChatStore>;

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
      fetcher: (openerTopicIds) => subTopicService.listOpened(openerTopicIds),
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
  ): Promise<SubTopicRetireResult> => {
    const result =
      action === 'archive'
        ? await subTopicService.archive(topicId, mode)
        : await subTopicService.trash(topicId, mode);
    if (this.#get().activeTopicId === topicId) this.#get().switchTopic(null);
    await Promise.all([this.#get().refreshTopic(), this.refreshSubTopics()]);
    return result;
  };

  /** Move sub-topics to the top level. */
  detachSubTopics = async (topicIds: string[]): Promise<SubTopicDetachResult> => {
    const result = await subTopicService.detach(topicIds);
    await Promise.all([this.#get().refreshTopic(), this.refreshSubTopics()]);
    return result;
  };
}

export type ChatSubTopicAction = Pick<
  ChatSubTopicActionImpl,
  'detachSubTopics' | 'refreshSubTopics' | 'retireTopicTree' | 'useFetchSubTopics'
>;

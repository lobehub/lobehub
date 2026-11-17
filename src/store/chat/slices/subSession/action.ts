import { createReplicaSlice, recordLens, type ReplicaSyncResult } from '@/libs/replica';
import {
  type SubSessionDetachResult,
  type SubSessionRetireResult,
  subSessionService,
} from '@/services/subSession';
import type { ChatStore } from '@/store/chat/store';
import type { StoreSetter } from '@/store/types';
import { setNamespace } from '@/utils/storeDebug';

import { subSessionTreeKey, subSessionTreeResource } from './projection';

const MAX_REFRESHED_VIEWS = 4;

const n = setNamespace('subSession');

type Setter = StoreSetter<ChatStore>;

export class ChatSubSessionActionImpl {
  readonly #get: () => ChatStore;
  readonly #tree;
  /** The opener sets on screen (sidebar page, Overview), so a write refreshes exactly those. */
  readonly #mounted = new Map<string, string[]>();

  constructor(set: Setter, get: () => ChatStore, _api?: unknown) {
    void _api;
    this.#get = get;
    this.#tree = createReplicaSlice(subSessionTreeResource, {
      actionPrefix: n('tree'),
      fetcher: (openerTopicIds) => subSessionService.listOpened(openerTopicIds),
      get,
      set,
      stateKey: 'subSessionTreeReplica',
      view: recordLens<ChatStore, any>('subSessionTreeMap'),
    });
  }

  /**
   * The sub-sessions under the sidebar's visible openers. Read the result
   * with `subSessionSelectors.treeOf(openerTopicIds)`.
   */
  useFetchSubSessions = (enabled: boolean, openerTopicIds: string[]): ReplicaSyncResult => {
    if (enabled && openerTopicIds.length > 0) {
      const key = subSessionTreeKey(openerTopicIds);
      this.#mounted.delete(key);
      this.#mounted.set(key, openerTopicIds);
      // Only the most recent views matter; older pages are gone from the screen.
      while (this.#mounted.size > MAX_REFRESHED_VIEWS) {
        this.#mounted.delete(this.#mounted.keys().next().value!);
      }
    }
    return this.#tree.useSync(openerTopicIds, {
      enabled: enabled && openerTopicIds.length > 0,
    });
  };

  /** Re-read the hierarchy on screen after a sub-session moved, opened or retired. */
  refreshSubSessions = async (): Promise<void> => {
    await Promise.all(
      [...this.#mounted.values()].map((openers) =>
        this.#tree.fetch(openers, { fresh: true }).catch(() => undefined),
      ),
    );
  };

  /**
   * Archive or trash a topic with sub-sessions: `all` stops and retires every
   * descendant too; `self` retires only this one and moves its sub-sessions to
   * the top level. Refreshes the topic list and the hierarchy afterwards.
   */
  retireTopicTree = async (
    topicId: string,
    action: 'archive' | 'trash',
    mode: 'all' | 'self',
  ): Promise<SubSessionRetireResult> => {
    const result =
      action === 'archive'
        ? await subSessionService.archive(topicId, mode)
        : await subSessionService.trash(topicId, mode);
    if (this.#get().activeTopicId === topicId) this.#get().switchTopic(null);
    await Promise.all([this.#get().refreshTopic(), this.refreshSubSessions()]);
    return result;
  };

  /** Move sub-sessions to the top level. */
  detachSubSessions = async (topicIds: string[]): Promise<SubSessionDetachResult> => {
    const result = await subSessionService.detach(topicIds);
    await Promise.all([this.#get().refreshTopic(), this.refreshSubSessions()]);
    return result;
  };
}

export type ChatSubSessionAction = Pick<
  ChatSubSessionActionImpl,
  'detachSubSessions' | 'refreshSubSessions' | 'retireTopicTree' | 'useFetchSubSessions'
>;

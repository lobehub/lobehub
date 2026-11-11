import { createReplicaSlice, recordLens, type ReplicaSyncResult } from '@/libs/replica';
import { topicService } from '@/services/topic';
import type { ChatStore } from '@/store/chat';
import type { StoreSetter } from '@/store/types';
import { setNamespace } from '@/utils/storeDebug';

import {
  type TopicShareEntry,
  type TopicShareInfo,
  topicShareResource,
  type TopicShareVisibility,
} from './projection';

/** Keep the fields the popover reads; write results carry the whole row. */
const toShareInfo = (record: {
  id: string;
  topicId: string;
  userId: string;
  visibility: string;
}): TopicShareInfo => ({
  id: record.id,
  topicId: record.topicId,
  userId: record.userId,
  visibility: record.visibility as TopicShareVisibility,
});

type Setter = StoreSetter<ChatStore>;

const createTopicShareSlice = (set: Setter, get: () => ChatStore) =>
  createReplicaSlice(topicShareResource, {
    actionPrefix: setNamespace('t')('topicShare'),
    fetcher: async (topicId): Promise<TopicShareEntry> => {
      const record = await topicService.getShareInfo(topicId);
      return { share: record ? toShareInfo(record) : null };
    },
    get,
    set,
    stateKey: 'topicShareReplica',
    // "No record" is never persisted, and evicts a record persisted earlier.
    toPersisted: (data) => (data.share ? data : null),
    view: recordLens<ChatStore, TopicShareEntry>('topicShareMap'),
  });

/** The share record behind the topic Share popover → `topicShareMap[topicId]`. */
export class ChatTopicShareActionImpl {
  readonly #get: () => ChatStore;
  readonly #share;

  constructor(set: Setter, get: () => ChatStore, _api?: unknown) {
    void _api;
    this.#get = get;
    this.#share = createTopicShareSlice(set, get);
  }

  /**
   * The topic's share record for the Share popover; read it with
   * `topicSelectors.getTopicShare`. An absent id (or no share permission)
   * disables the read.
   */
  useFetchTopicShare = (topicId?: string | null, enabled = true): ReplicaSyncResult =>
    this.#share.useSync(enabled && topicId ? topicId : null, {
      dedupingInterval: 10_000,
      revalidateOnFocus: false,
    });

  /**
   * Change a topic's share visibility and land the server's record on the
   * replica (persisted). Resolves to the share id after the change.
   */
  setTopicShareVisibility = async (
    topicId: string,
    visibility: TopicShareVisibility,
  ): Promise<string | undefined> => {
    // The record belongs to the identity that started the change; never adopt
    // (and persist) it into another account's or workspace's scope.
    const scope = this.#share.resource.scope.get();
    const current = this.#get().topicShareMap[topicId]?.share;

    let record = current
      ? await topicService.updateShareVisibility(topicId, visibility)
      : await topicService.enableSharing(topicId, visibility);
    // A stale copy can miss a record created elsewhere; create then keeps the
    // existing visibility, so apply the requested one on top.
    if (record && record.visibility !== visibility)
      record = await topicService.updateShareVisibility(topicId, visibility);

    const isSameScope = this.#share.resource.scope.get() === scope;

    if (record) {
      const share = toShareInfo(record);
      if (isSameScope) this.#share.update(topicId, () => ({ share }));
      return share.id;
    }
    if (!isSameScope) return current?.id;

    await this.#share.fetch(topicId, { fresh: true });
    return this.#get().topicShareMap[topicId]?.share?.id ?? current?.id;
  };
}

export type ChatTopicShareAction = Pick<ChatTopicShareActionImpl, keyof ChatTopicShareActionImpl>;

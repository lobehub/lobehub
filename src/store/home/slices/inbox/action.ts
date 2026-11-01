import { createReplicaSlice, recordLens, type ReplicaSyncResult } from '@/libs/replica';
import { type HomeDailyBriefResponse, homeService } from '@/services/home';
import { type TopicListItem, topicService } from '@/services/topic';
import type { HomeStore } from '@/store/home/store';
import type { StoreSetter } from '@/store/types';
import { type ChatTopicStatus } from '@/types/topic';
import { setNamespace } from '@/utils/storeDebug';

import {
  HOME_INBOX_KEY,
  homeDailyBriefResource,
  type HomeFeedParams,
  homeInboxTopicsResource,
} from './projection';

const n = setNamespace('homeInbox');

/**
 * Everything the home inbox needs from topics, in one round trip. `queryTopics`
 * filters server-side by status, so widening this list costs nothing extra.
 */
const INBOX_STATUSES: ChatTopicStatus[] = ['running', 'unread'];

const FEED_PARAMS: HomeFeedParams = {};

/** How long the server's own status write gets before the inbox reconciles with it. */
const PROMOTE_RECONCILE_DELAY = 1000;

type Setter = StoreSetter<HomeStore>;
export const createHomeInboxSlice = (set: Setter, get: () => HomeStore, _api?: unknown) =>
  new HomeInboxActionImpl(set, get, _api);

export class HomeInboxActionImpl {
  readonly #dailyBrief;
  readonly #inboxTopics;

  constructor(set: Setter, get: () => HomeStore, _api?: unknown) {
    void _api;
    this.#inboxTopics = createReplicaSlice(homeInboxTopicsResource, {
      actionPrefix: n('inboxTopics'),
      // `withLastMessage` is what makes an unread row readable: the card shows what
      // the agent actually said, not just the topic title it was filed under.
      fetcher: () => topicService.queryTopics({ statuses: INBOX_STATUSES, withLastMessage: true }),
      get,
      set,
      stateKey: 'homeInboxTopicsReplica',
      view: recordLens<HomeStore, TopicListItem[]>('homeInboxTopicsMap'),
    });
    this.#dailyBrief = createReplicaSlice(homeDailyBriefResource, {
      actionPrefix: n('dailyBrief'),
      fetcher: () => homeService.getDailyBrief(),
      get,
      set,
      stateKey: 'homeDailyBriefReplica',
      view: recordLens<HomeStore, HomeDailyBriefResponse>('homeDailyBriefMap'),
    });
  }

  /**
   * Flip a just-replied topic to `running` on the same tick as the send, so it
   * moves out of "unread" into the running card. The server's own status write
   * lands a beat later, so reconcile after a short delay rather than now (an
   * immediate refetch would read the row still `unread` and snap it back).
   */
  promoteInboxTopicToRunning = (topicId: string): void => {
    this.#inboxTopics.update(
      HOME_INBOX_KEY,
      (rows) =>
        rows?.map((row) =>
          row.id === topicId ? { ...row, status: 'running' as ChatTopicStatus } : row,
        ),
      { persist: false },
    );
    setTimeout(() => void this.#inboxTopics.revalidate(HOME_INBOX_KEY), PROMOTE_RECONCILE_DELAY);
  };

  /** Read the pairs with `homeInboxSelectors.dailyBrief`. */
  useFetchHomeDailyBrief = (isLogin: boolean | undefined): ReplicaSyncResult =>
    this.#dailyBrief.useSync(FEED_PARAMS, { enabled: isLogin === true });

  /**
   * Account-wide topic feed for the home inbox. A live overview: it refetches on
   * focus almost immediately (the default throttle is 5 min), so a run that just
   * finished shows up the instant the user looks. Read the rows with
   * `homeInboxSelectors.inboxTopics`.
   */
  useFetchHomeInboxTopics = (isLogin: boolean | undefined): ReplicaSyncResult =>
    this.#inboxTopics.useSync(FEED_PARAMS, {
      enabled: isLogin === true,
      focusThrottleInterval: 1000,
    });
}

export type HomeInboxAction = Pick<HomeInboxActionImpl, keyof HomeInboxActionImpl>;

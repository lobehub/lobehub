import { useMemo } from 'react';

import { type TopicListItem } from '@/services/topic';
import { useHomeStore } from '@/store/home';
import { homeInboxSelectors } from '@/store/home/selectors';

export type InboxTopic = TopicListItem;

export interface HomeInboxTopics {
  error: unknown;
  isInit: boolean;
  /** Rows are on screen (possibly the local copy) and a refresh is in flight. */
  isRefreshing: boolean;
  /**
   * Optimistically flip a just-replied topic to `running` so it moves out of
   * "unread" and into the running card the instant the user hits send — then
   * reconcile with the server once its status write has landed.
   */
  promoteToRunning: (topicId: string) => void;
  reload: () => void;
  /** Topics still executing — the collapsed "N running" card. */
  running: InboxTopic[];
  /** Topics that finished while the user was away and haven't been opened yet. */
  unread: InboxTopic[];
}

const EMPTY: InboxTopic[] = [];

/**
 * Account-wide topic feed for the home inbox. Deliberately NOT reusing
 * `HomeRepository.getUnreadCounts()` — that one excludes cron/task-triggered
 * topics (it powers a sidebar badge), which are exactly the ones an agent
 * inbox must surface.
 *
 * The rows are a replica: a reload paints the last feed from the local copy
 * and the server only confirms it.
 */
export const useHomeInboxTopics = (isLogin: boolean | undefined): HomeInboxTopics => {
  const { error, isValidating, revalidate } = useHomeStore((s) => s.useFetchHomeInboxTopics)(
    isLogin,
  );
  const promoteToRunning = useHomeStore((s) => s.promoteInboxTopicToRunning);
  const data = useHomeStore(homeInboxSelectors.inboxTopics);

  // Only a first-load failure is a hard error. A background poll error while we
  // still hold rows keeps the stale list instead of flapping to "nothing here".
  const hasHardError = Boolean(error) && data === undefined;
  const topics = data ?? EMPTY;

  return useMemo(
    () => ({
      error: hasHardError ? error : undefined,
      isInit: (isLogin !== true || data !== undefined) && !hasHardError,
      isRefreshing: isValidating && data !== undefined,
      promoteToRunning,
      reload: () => void revalidate(),
      running: topics.filter((t) => t.status === 'running'),
      unread: topics.filter((t) => t.status === 'unread'),
    }),
    [data, topics, error, hasHardError, isLogin, isValidating, promoteToRunning, revalidate],
  );
};

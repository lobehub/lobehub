import { useMemo } from 'react';

import { useClientDataSWR } from '@/libs/swr';
import { homeInboxKeys } from '@/libs/swr/keys';
import { topicService } from '@/services/topic';
import { type ChatTopic, type ChatTopicStatus } from '@/types/topic';

/**
 * Everything the home inbox needs from topics, in one round trip. `queryTopics`
 * filters server-side by status, so widening this list costs nothing extra.
 */
const INBOX_STATUSES: ChatTopicStatus[] = ['running', 'unread'];

/** `queryTopics` returns raw topic rows, which carry `agentId` even though `ChatTopic` doesn't declare it. */
export type InboxTopic = ChatTopic & { agentId?: string | null };

export interface HomeInboxTopics {
  error: unknown;
  isInit: boolean;
  reload: () => void;
  /** Topics still executing — the collapsed "N running" card. */
  running: InboxTopic[];
  /** Topics that finished while the user was away and haven't been opened yet. */
  unread: InboxTopic[];
}

/**
 * Account-wide topic feed for the home inbox. Deliberately NOT reusing
 * `HomeRepository.getUnreadCounts()` — that one excludes cron/task-triggered
 * topics (it powers a sidebar badge), which are exactly the ones an agent
 * inbox must surface.
 */
export const useHomeInboxTopics = (isLogin: boolean | undefined): HomeInboxTopics => {
  const { data, error, isLoading, mutate } = useClientDataSWR(
    isLogin ? homeInboxKeys.topics(isLogin) : null,
    () => topicService.queryTopics({ statuses: INBOX_STATUSES }),
    // A live overview: refetch on focus almost immediately (default throttle is
    // 5min) so a run that just finished shows up the instant the user looks.
    { focusThrottleInterval: 1000 },
  );

  // Only a first-load failure is a hard error. A background poll error while we
  // still hold rows keeps the stale list instead of flapping to "nothing here".
  const hasHardError = Boolean(error) && data === undefined;
  const topics = useMemo(() => (data ?? []) as InboxTopic[], [data]);

  return useMemo(
    () => ({
      error: hasHardError ? error : undefined,
      isInit: !isLoading && !hasHardError,
      reload: mutate,
      running: topics.filter((t) => t.status === 'running'),
      unread: topics.filter((t) => t.status === 'unread'),
    }),
    [topics, error, hasHardError, isLoading, mutate],
  );
};

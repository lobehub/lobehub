import { useEffect, useMemo } from 'react';

import { STALE_RUNNING_TOPIC_TIMEOUT } from '@/const/topic';
import { useClientDataSWR } from '@/libs/swr';
import { homeInboxKeys } from '@/libs/swr/keys';
import { type TopicListItem, topicService } from '@/services/topic';
import { useChatStore } from '@/store/chat';
import { type ChatTopicStatus } from '@/types/topic';

/**
 * Everything the home inbox needs from topics, in one round trip. `queryTopics`
 * filters server-side by status, so widening this list costs nothing extra.
 */
const INBOX_STATUSES: ChatTopicStatus[] = ['running', 'unread'];

export type InboxTopic = TopicListItem;

export interface HomeInboxTopics {
  error: unknown;
  isInit: boolean;
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

/**
 * Account-wide topic feed for the home inbox. Deliberately NOT reusing
 * `HomeRepository.getUnreadCounts()` — that one excludes cron/task-triggered
 * topics (it powers a sidebar badge), which are exactly the ones an agent
 * inbox must surface.
 */
export const useHomeInboxTopics = (isLogin: boolean | undefined): HomeInboxTopics => {
  const cleanupStaleRunningTopics = useChatStore((s) => s.cleanupStaleRunningTopics);
  const { data, error, isLoading, mutate } = useClientDataSWR(
    isLogin ? homeInboxKeys.topics(isLogin) : null,
    // `withLastMessage` is what makes an unread row readable: the card shows what
    // the agent actually said, not just the topic title it was filed under.
    () => topicService.queryTopics({ statuses: INBOX_STATUSES, withLastMessage: true }),
    // A live overview: refetch on focus almost immediately (default throttle is
    // 5min) so a run that just finished shows up the instant the user looks.
    { focusThrottleInterval: 1000 },
  );

  // A genuine server run carries `runStartedAt` from its live top-level
  // operation. For running rows without one, schedule the existing age-gated
  // watchdog at the earliest candidate's stale threshold. The watchdog also
  // checks this tab's local operations, so client-runtime runs remain protected.
  useEffect(() => {
    const candidates = data?.filter((topic) => topic.status === 'running' && !topic.runStartedAt);
    if (!isLogin || !candidates || candidates.length === 0) return;

    let disposed = false;
    const nextCleanupAt = Math.min(
      ...candidates.map((topic) => topic.updatedAt + STALE_RUNNING_TOPIC_TIMEOUT + 1),
    );
    const delay = Math.max(0, nextCleanupAt - Date.now());
    const timeout = setTimeout(() => {
      void cleanupStaleRunningTopics().then((cleanedCount) => {
        if (!disposed && cleanedCount > 0) void mutate();
      });
    }, delay);

    return () => {
      disposed = true;
      clearTimeout(timeout);
    };
  }, [cleanupStaleRunningTopics, data, isLogin, mutate]);

  // Only a first-load failure is a hard error. A background poll error while we
  // still hold rows keeps the stale list instead of flapping to "nothing here".
  const hasHardError = Boolean(error) && data === undefined;
  const topics = useMemo(() => (data ?? []) as InboxTopic[], [data]);

  return useMemo(
    () => ({
      error: hasHardError ? error : undefined,
      isInit: !isLoading && !hasHardError,
      promoteToRunning: (topicId: string) => {
        // Instant: patch the cached row to `running` with no refetch, so the UI
        // responds on the same tick as the send. The server's own status write
        // lands a beat later, so reconcile after a short delay rather than
        // revalidating now and reading the row still `unread` (which would snap
        // it back to unread and look like the send did nothing).
        void mutate(
          (rows) =>
            (rows ?? []).map((row) =>
              row.id === topicId ? { ...row, status: 'running' as ChatTopicStatus } : row,
            ),
          { revalidate: false },
        );
        setTimeout(() => void mutate(), 1000);
      },
      reload: mutate,
      running: topics.filter((t) => t.status === 'running'),
      unread: topics.filter((t) => t.status === 'unread'),
    }),
    [topics, error, hasHardError, isLoading, mutate],
  );
};

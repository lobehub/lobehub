import { useMemo } from 'react';

import { useClientDataSWR } from '@/libs/swr';
import { fleetKeys } from '@/libs/swr/keys';
import { topicService } from '@/services/topic';
import { type ChatTopic, type ChatTopicStatus } from '@/types/topic';

import { type FleetColumn, fleetColumnKey } from './types';

// Topic statuses considered "actively running" for the Fleet board.
const RUNNING_STATUSES: ChatTopicStatus[] = ['running'];

// queryTopics returns raw topic rows, which carry agentId even though the
// shared ChatTopic type does not declare it.
type RunningTopic = ChatTopic & { agentId?: string | null };

const toColumn = (topic: RunningTopic): FleetColumn | null => {
  if (!topic.agentId) return null;
  return {
    agentId: topic.agentId,
    fallbackTitle: topic.title || topic.id,
    key: fleetColumnKey(topic.agentId, topic.id),
    threadId: null,
    topicId: topic.id,
    workingDirectory: topic.metadata?.workingDirectory ?? null,
  };
};

/**
 * Account-wide source of "running" work. Queries the current user's topics
 * filtered server-side to the actively-running statuses — one column per
 * running topic. Exposes the derived columns (board) plus a key→status map
 * (sidebar / column badge).
 */
export const useRunningTopics = () => {
  const { data, error, isLoading, mutate } = useClientDataSWR(
    fleetKeys.runningTopics(),
    () => topicService.queryTopics({ statuses: RUNNING_STATUSES }),
    // The board is a live overview — refetch on focus almost immediately
    // (default throttle is 5min) so newly-running topics show up the instant
    // the user looks at it.
    { focusThrottleInterval: 1000 },
  );

  // Only a first-load failure (no data yet) is a hard error worth a failed
  // state; a background poll error while we still hold columns keeps the stale
  // list instead of flapping to "no running tasks".
  const hasHardError = Boolean(error) && data === undefined;

  const running = useMemo(() => (data ?? []) as RunningTopic[], [data]);

  const columns = useMemo(
    () => running.map(toColumn).filter((c): c is FleetColumn => Boolean(c)),
    [running],
  );

  const statusByColumnKey = useMemo(() => {
    const map: Record<string, ChatTopicStatus | undefined> = {};
    for (const topic of running) {
      if (!topic.agentId) continue;
      map[fleetColumnKey(topic.agentId, topic.id)] = topic.status ?? undefined;
    }
    return map;
  }, [running]);

  // `isInit` is gated on `!hasHardError` so a failed first fetch is NOT treated
  // as "loaded, nothing running" (which would collapse every status to idle and
  // let close-idle wipe live columns).
  return {
    columns,
    error: hasHardError ? error : undefined,
    isInit: !isLoading && !hasHardError,
    reload: mutate,
    statusByColumnKey,
  };
};

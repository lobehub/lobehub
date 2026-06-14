import { useMemo } from 'react';

import { useClientDataSWR } from '@/libs/swr';
import { topicService } from '@/services/topic';
import { type ChatTopic, type ChatTopicStatus } from '@/types/topic';

import { type FleetColumn, fleetColumnKey } from './types';

// Topic statuses considered "actively running" for the Fleet board.
const RUNNING_STATUSES: ChatTopicStatus[] = ['running'];

// getAllTopics returns raw topic rows, which carry agentId even though the
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
  };
};

/**
 * Account-wide source of "running" work. Pulls every topic for the current
 * user and keeps the ones whose status is actively running — one column per
 * running topic. Exposes the derived columns (board) plus a key→status map
 * (sidebar / column badge).
 */
export const useRunningTopics = () => {
  // NOTE: getAllTopics returns the full topic set and we filter client-side.
  // For accounts with many topics this is heavy — a dedicated server-side
  // `getRunningTopics` query (topicModel.queryByStatuses + TRPC) is a planned
  // follow-up optimisation.
  const { data, isLoading } = useClientDataSWR('fleet-running-topics', () =>
    topicService.getAllTopics(),
  );

  const running = useMemo(
    () =>
      ((data ?? []) as RunningTopic[]).filter(
        (t) => !!t.status && RUNNING_STATUSES.includes(t.status),
      ),
    [data],
  );

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

  return { columns, isInit: !isLoading, statusByColumnKey };
};

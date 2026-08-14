import { useEffect } from 'react';

import { useClientPollingSWR } from '@/libs/swr';
import { agentService } from '@/services/agent';
import { chatGroupService } from '@/services/chatGroup';
import { useChatStore } from '@/store/chat';
import { topicSelectors } from '@/store/chat/selectors';

/**
 * What a migration surface is keyed on. Exactly one side is set: agent
 * conversations poll by `agentId`, group conversations by `groupId` (a group's
 * job is registered against the group, not its member agents — an empty roster
 * would otherwise have nothing to look up).
 */
export interface MigrationTarget {
  agentId?: null | string;
  groupId?: null | string;
}

/**
 * Topics this client can currently show for the active agent/group: the loaded
 * sidebar list plus the open topic. Sent with the status poll so the server
 * only reports pending state for these instead of the job's whole queue
 * (which can hold tens of thousands of topics).
 *
 * Group and agent surfaces share this: both drive the same chat store topic
 * list.
 */
const getVisibleTopicIds = (): string[] => {
  const state = useChatStore.getState();
  const loaded = topicSelectors.currentTopics(state)?.map((topic) => topic.id) ?? [];
  const active = state.activeTopicId;
  // The active topic goes first so the cap can never trim it away — its
  // pending state gates the conversation surface.
  const ids = active ? [active, ...loaded.filter((id) => id !== active)] : loaded;
  return ids.slice(0, 1000);
};

export interface AgentTransferJobStatus {
  completedTopics: number;
  jobId: string;
  pendingTopicIds: string[];
  totalTopics: number;
  /** Job kind (`transfer` | `copy`) — progress hints are worded by it. */
  type: string;
}

/**
 * Poll the async history-backfill status of a transferred/copied agent or
 * chat group.
 *
 * One cheap indexed query per tick; polling only runs while a job is actually
 * pending (`data` non-null) and stops itself once the job completes, so the
 * steady state for every normal conversation is a single request per switch.
 *
 * Many components subscribe to the same key at once (header badge, chat
 * placeholder, one indicator per sidebar topic row), so the deduping window
 * sits just under the tick: each tick issues ONE request no matter how many
 * rows are visible.
 */
export const useAgentTransferJob = ({ agentId, groupId }: MigrationTarget) => {
  const response = useClientPollingSWR<AgentTransferJobStatus | null>(
    // `groupId` wins when both are present: on a group page the context's
    // `agentId` is the group's supervisor, whose own job (if any) is not the
    // one gating these conversations.
    groupId ? ['group-transfer-job', groupId] : agentId ? ['agent-transfer-job', agentId] : null,
    () =>
      groupId
        ? chatGroupService.getTransferJobStatus(groupId, getVisibleTopicIds())
        : agentService.getTransferJobStatus(agentId!, getVisibleTopicIds()),
    {
      dedupingInterval: 2500,
      refreshInterval: (data) => (data ? 3000 : 0),
    },
  );

  // The candidate set is an implicit fetcher argument, not part of the SWR
  // key: opening a topic that the previous (capped) candidates missed would
  // otherwise read stale `pendingTopicIds` until the next 3s tick, leaving
  // the conversation ungated against unmigrated history. Revalidate the
  // moment the active topic changes while a job is pending.
  const activeTopicId = useChatStore((s) => s.activeTopicId);
  const hasPendingJob = !!response.data;
  const { mutate } = response;
  useEffect(() => {
    if (hasPendingJob) void mutate();
  }, [activeTopicId, hasPendingJob, mutate]);

  return response;
};

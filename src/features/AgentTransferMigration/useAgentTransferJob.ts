import { useClientPollingSWR } from '@/libs/swr';
import { agentService } from '@/services/agent';

export interface AgentTransferJobStatus {
  completedTopics: number;
  jobId: string;
  pendingTopicIds: string[];
  totalTopics: number;
}

/**
 * Poll the async history-backfill status of a transferred agent.
 *
 * One cheap indexed query per tick; polling only runs while a job is actually
 * pending (`data` non-null) and stops itself once the job completes, so the
 * steady state for every normal agent is a single request per agent switch.
 *
 * Many components subscribe to the same key at once (header badge, chat
 * placeholder, one indicator per sidebar topic row), so the deduping window
 * sits just under the tick: each tick issues ONE request no matter how many
 * rows are visible.
 */
export const useAgentTransferJob = (agentId?: string | null) =>
  useClientPollingSWR<AgentTransferJobStatus | null>(
    agentId ? ['agent-transfer-job', agentId] : null,
    () => agentService.getTransferJobStatus(agentId!),
    {
      dedupingInterval: 2500,
      refreshInterval: (data) => (data ? 3000 : 0),
    },
  );

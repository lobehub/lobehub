import { useClientDataSWR } from '@/libs/swr';
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
 */
export const useAgentTransferJob = (agentId?: string | null) =>
  useClientDataSWR<AgentTransferJobStatus | null>(
    agentId ? ['agent-transfer-job', agentId] : null,
    () => agentService.getTransferJobStatus(agentId!),
    {
      refreshInterval: (data) => (data ? 3000 : 0),
    },
  );

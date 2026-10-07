import { useClientDataSWR } from '@/libs/swr';
import { evalKeys } from '@/libs/swr/keys';
import { agentService } from '@/services/agent';

export interface AgentOption {
  avatar?: string | null;
  backgroundColor?: string | null;
  description?: string | null;
  id: string;
  title?: string | null;
}

const EMPTY: AgentOption[] = [];

/**
 * The agents an eval run can target. Shared by the run create and edit
 * modals so reopening either one reuses the cached list instead of
 * refetching it on every mount.
 */
export const useAgentOptions = (enabled = true) => {
  const { data, isLoading } = useClientDataSWR<AgentOption[]>(
    enabled ? evalKeys.agentOptions() : null,
    async () => (await agentService.queryAgents()) as AgentOption[],
  );

  return { agents: data ?? EMPTY, loadingAgents: isLoading };
};

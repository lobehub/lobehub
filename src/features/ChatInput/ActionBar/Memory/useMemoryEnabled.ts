import { useAgentValue } from '@/store/agent/projection';
import { useUserStore } from '@/store/user';
import { settingsSelectors } from '@/store/user/selectors';

/**
 * Returns the effective memory enabled state for an agent.
 * Agent-level config takes priority; falls back to user-level setting.
 */
export const useMemoryEnabled = (agentId: string): boolean => {
  const agentMemoryEnabled = useAgentValue(agentId, (agent) => agent?.chatConfig?.memory?.enabled);
  const userMemoryEnabled = useUserStore(settingsSelectors.memoryEnabled);

  return agentMemoryEnabled ?? userMemoryEnabled;
};

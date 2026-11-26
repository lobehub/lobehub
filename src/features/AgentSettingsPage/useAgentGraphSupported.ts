import { useAgentStore } from '@/store/agent';
import { agentSelectors, builtinAgentSelectors } from '@/store/agent/selectors';
import { useUserStore } from '@/store/user';
import { labPreferSelectors } from '@/store/user/selectors';

/** Graph runtime is a Labs option for custom agents that run on the built-in runtime. */
export const useAgentGraphSupported = () => {
  const enabled = useUserStore(labPreferSelectors.enableAgentGraphConfig);
  const isInbox = useAgentStore(builtinAgentSelectors.isInboxAgent);
  const isHeterogeneous = useAgentStore(agentSelectors.isCurrentAgentHeterogeneous);

  return !!enabled && !isInbox && !isHeterogeneous;
};

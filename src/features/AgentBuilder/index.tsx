import { BUILTIN_AGENT_SLUGS } from '@lobechat/builtin-agents';
import { memo } from 'react';

import Loading from '@/components/Loading/BrandTextLoading';
import RightPanel from '@/features/RightPanel';
import { useAgentStore } from '@/store/agent';
import { builtinAgentSelectors } from '@/store/agent/selectors';

import AgentBuilderConversation from './AgentBuilderConversation';
import AgentBuilderProvider from './AgentBuilderProvider';

const AgentBuilder = memo(() => {
  const agentId = useAgentStore((s) => s.activeAgentId);
  const agentBuilderId = useAgentStore(builtinAgentSelectors.agentBuilderId);

  const useInitBuiltinAgent = useAgentStore((s) => s.useInitBuiltinAgent);
  useInitBuiltinAgent(BUILTIN_AGENT_SLUGS.agentBuilder);

  return (
    <RightPanel>
      {agentId && agentBuilderId ? (
        <AgentBuilderProvider agentId={agentBuilderId}>
          <AgentBuilderConversation agentId={agentBuilderId} />
        </AgentBuilderProvider>
      ) : (
        <Loading debugId="AgentBuilder > Init" />
      )}
    </RightPanel>
  );
});

export default AgentBuilder;

import { BUILTIN_AGENT_SLUGS } from '@lobechat/builtin-agents';
import { memo } from 'react';

import Loading from '@/components/Loading/BrandTextLoading';
import RightPanel from '@/features/RightPanel';
import { useAgentStore } from '@/store/agent';
import { builtinAgentSelectors } from '@/store/agent/selectors';
import { useGlobalStore } from '@/store/global';
import { systemStatusSelectors } from '@/store/global/selectors';

import AgentBuilderConversation from './AgentBuilderConversation';
import AgentBuilderProvider from './AgentBuilderProvider';

const AgentBuilder = memo(() => {
  const agentId = useAgentStore((s) => s.activeAgentId);
  const agentBuilderId = useAgentStore(builtinAgentSelectors.agentBuilderId);

  const [showAgentBuilderPanel, toggleAgentBuilderPanel, width, updateSystemStatus] =
    useGlobalStore((s) => [
      systemStatusSelectors.showAgentBuilderPanel(s),
      s.toggleAgentBuilderPanel,
      systemStatusSelectors.agentBuilderPanelWidth(s),
      s.updateSystemStatus,
    ]);

  const useInitBuiltinAgent = useAgentStore((s) => s.useInitBuiltinAgent);
  useInitBuiltinAgent(BUILTIN_AGENT_SLUGS.agentBuilder);

  return (
    <RightPanel
      stableLayout
      defaultWidth={width}
      expand={showAgentBuilderPanel}
      onExpandChange={toggleAgentBuilderPanel}
      onSizeChange={(size) => {
        if (size?.width) {
          const w = typeof size.width === 'string' ? Number.parseInt(size.width) : size.width;
          if (!!w) updateSystemStatus({ agentBuilderPanelWidth: w });
        }
      }}
    >
      {agentId && agentBuilderId ? (
        <AgentBuilderProvider agentId={agentBuilderId} editingAgentId={agentId}>
          <AgentBuilderConversation agentId={agentBuilderId} />
        </AgentBuilderProvider>
      ) : (
        <Loading debugId="AgentBuilder > Init" />
      )}
    </RightPanel>
  );
});

export default AgentBuilder;

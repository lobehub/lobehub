import { BUILTIN_AGENT_SLUGS } from '@lobechat/builtin-agents';
import { DraggablePanel } from '@lobehub/ui';
import { cssVar } from 'antd-style';
import { memo } from 'react';

import Loading from '@/components/Loading/BrandTextLoading';
import { useAgentStore } from '@/store/agent';
import { builtinAgentSelectors } from '@/store/agent/selectors';
import { useGlobalStore } from '@/store/global';
import { systemStatusSelectors } from '@/store/global/selectors';
import { useGroupProfileStore } from '@/store/groupProfile';

import AgentBuilderConversation from './AgentBuilderConversation';
import AgentBuilderProvider from './AgentBuilderProvider';

const AgentBuilder = memo(() => {
  const chatPanelExpanded = useGroupProfileStore((s) => s.chatPanelExpanded);
  const setChatPanelExpanded = useGroupProfileStore((s) => s.setChatPanelExpanded);
  const groupAgentBuilderId = useAgentStore(builtinAgentSelectors.groupAgentBuilderId);

  const [width, updateSystemStatus] = useGlobalStore((s) => [
    systemStatusSelectors.groupAgentBuilderPanelWidth(s),
    s.updateSystemStatus,
  ]);

  const useInitBuiltinAgent = useAgentStore((s) => s.useInitBuiltinAgent);
  useInitBuiltinAgent(BUILTIN_AGENT_SLUGS.groupAgentBuilder);

  return (
    <DraggablePanel
      backgroundColor={cssVar.colorBgContainer}
      expand={chatPanelExpanded}
      expandable={false}
      maxWidth={600}
      minWidth={360}
      placement="right"
      size={{
        height: '100%',
        width,
      }}
      onExpandChange={setChatPanelExpanded}
      onSizeChange={(_, size) => {
        if (size?.width) {
          const w = typeof size.width === 'string' ? Number.parseInt(size.width) : size.width;
          if (!!w) updateSystemStatus({ groupAgentBuilderPanelWidth: w });
        }
      }}
    >
      {groupAgentBuilderId ? (
        <AgentBuilderProvider agentId={groupAgentBuilderId}>
          <AgentBuilderConversation agentId={groupAgentBuilderId} />
        </AgentBuilderProvider>
      ) : (
        <Loading debugId="GroupAgentBuilder > Init" />
      )}
    </DraggablePanel>
  );
});

export default AgentBuilder;

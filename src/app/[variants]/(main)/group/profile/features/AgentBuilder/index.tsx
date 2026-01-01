import { BUILTIN_AGENT_SLUGS } from '@lobechat/builtin-agents';
import { DraggablePanel } from '@lobehub/ui';
import { cssVar } from 'antd-style';
import { memo, useState } from 'react';

import Loading from '@/components/Loading/BrandTextLoading';
import { useAgentStore } from '@/store/agent';
import { builtinAgentSelectors } from '@/store/agent/selectors';

import { useProfileStore } from '../store';
import AgentBuilderConversation from './AgentBuilderConversation';
import AgentBuilderProvider from './AgentBuilderProvider';

const AgentBuilder = memo(() => {
  const chatPanelExpanded = useProfileStore((s) => s.chatPanelExpanded);
  const setChatPanelExpanded = useProfileStore((s) => s.setChatPanelExpanded);
  const groupAgentBuilderId = useAgentStore(builtinAgentSelectors.groupAgentBuilderId);

  console.log('groupAgentBuilderId', groupAgentBuilderId);
  const [width, setWidth] = useState<string | number>(360);

  const useInitBuiltinAgent = useAgentStore((s) => s.useInitBuiltinAgent);
  useInitBuiltinAgent(BUILTIN_AGENT_SLUGS.groupAgentBuilder);

  return (
    <DraggablePanel
      backgroundColor={cssVar.colorBgContainer}
      expand={chatPanelExpanded}
      expandable={false}
      maxWidth={600}
      minWidth={360}
      onExpandChange={setChatPanelExpanded}
      onSizeChange={(_, size) => {
        if (size?.width) {
          setWidth(size.width);
        }
      }}
      placement="right"
      size={{
        height: '100%',
        width,
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

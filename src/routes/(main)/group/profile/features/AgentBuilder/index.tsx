import { BUILTIN_AGENT_SLUGS } from '@lobechat/builtin-agents';
import { memo } from 'react';

import ConversationSegmentSkeleton from '@/components/Skeleton/Conversation/Segment';
import RightPanel from '@/features/RightPanel';
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
    // RightPanel: the same draggable side panel on desktop, a full-screen
    // drawer on mobile instead of a fixed-width column over the profile.
    <RightPanel
      expand={chatPanelExpanded}
      maxWidth={600}
      minWidth={360}
      width={width}
      onExpandChange={setChatPanelExpanded}
      onSizeChange={(size) => {
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
        <ConversationSegmentSkeleton />
      )}
    </RightPanel>
  );
});

export default AgentBuilder;

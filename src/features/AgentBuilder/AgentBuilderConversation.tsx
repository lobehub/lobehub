import { Flexbox } from '@lobehub/ui';
import { memo } from 'react';

import DragUploadZone, { useUploadFiles } from '@/components/DragUploadZone';
import { type ActionKeys } from '@/features/ChatInput';
import { ChatInput, ChatList } from '@/features/Conversation';
import { usePermission } from '@/hooks/usePermission';
import { useAgentStore } from '@/store/agent';
import { agentByIdSelectors } from '@/store/agent/selectors';

import AgentBuilderWelcome from './AgentBuilderWelcome';
import TopicSelector from './TopicSelector';

interface AgentBuilderConversationProps {
  agentId: string;
}
const actions: ActionKeys[] = ['model'];
const rightActions: ActionKeys[] = [];

/**
 * Agent Builder Conversation Component
 * Displays the chat interface for configuring the agent via conversation
 */
const AgentBuilderConversation = memo<AgentBuilderConversationProps>(({ agentId }) => {
  // Get agent's model info for vision support check
  const model = useAgentStore((s) => agentByIdSelectors.getAgentModelById(agentId)(s));
  const provider = useAgentStore((s) => agentByIdSelectors.getAgentModelProviderById(agentId)(s));
  const { handleUploadFiles } = useUploadFiles({ model, provider });
  const { allowed: canCreate } = usePermission('create_content');

  return (
    <DragUploadZone
      disabled={!canCreate}
      style={{ flex: 1, height: '100%' }}
      onUploadFiles={handleUploadFiles}
    >
      <Flexbox flex={1} height={'100%'}>
        <TopicSelector agentId={agentId} disabled={!canCreate} />
        <Flexbox flex={1} style={{ overflow: 'hidden' }}>
          <ChatList welcome={<AgentBuilderWelcome disabled={!canCreate} />} />
        </Flexbox>
        <ChatInput leftActions={actions} rightActions={rightActions} showControlBar={false} />
      </Flexbox>
    </DragUploadZone>
  );
});

export default AgentBuilderConversation;

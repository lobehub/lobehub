import { Flexbox } from '@lobehub/ui';
import { memo } from 'react';

import AgentBuilderWelcome from '@/features/AgentBuilder/AgentBuilderWelcome';
import { useResolveFeedbackOnSend } from '@/features/AgentBuilder/SuggestionChips/useResolveFeedbackOnSend';
import { type ActionKeys } from '@/features/ChatInput';
import { ChatInput, ChatList } from '@/features/Conversation';
import { usePermission } from '@/hooks/usePermission';

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
  const { allowed: canCreate } = usePermission('create_content');

  // Resolve usage_in_followup / manual_edit feedback when a suggestion-seeded
  // message is sent (no-op for normal sends).
  useResolveFeedbackOnSend();

  return (
    <Flexbox flex={1} height={'100%'}>
      <TopicSelector agentId={agentId} disabled={!canCreate} />
      <Flexbox flex={1} style={{ overflow: 'hidden' }}>
        <ChatList welcome={<AgentBuilderWelcome disabled={!canCreate} mode="groupBuilder" />} />
      </Flexbox>
      <ChatInput leftActions={actions} rightActions={rightActions} showControlBar={false} />
    </Flexbox>
  );
});

export default AgentBuilderConversation;

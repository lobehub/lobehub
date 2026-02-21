import { type ReactNode } from 'react';
import { memo, useMemo } from 'react';

import { ConversationProvider } from '@/features/Conversation';
import { useOperationState } from '@/hooks/useOperationState';
import { useChatStore } from '@/store/chat';
import { type MessageMapKeyInput } from '@/store/chat/utils/messageMapKey';
import { messageMapKey } from '@/store/chat/utils/messageMapKey';

interface AgentBuilderProviderProps {
  agentId: string;
  children: ReactNode;
}

/**
 * Group Agent Builder Conversation Provider
 * Provides context for the Group Agent Builder chat panel
 * Uses 'group_agent_builder' scope with groupId to isolate messages per group
 */
const AgentBuilderProvider = memo<AgentBuilderProviderProps>(({ agentId, children }) => {
  // Use activeTopicId from chatStore (synced with URL query 'bt' via ProfileHydration)
  const activeTopicId = useChatStore((s) => s.activeTopicId);

  // Build conversation context for group agent builder
  // Using group_agent_builder scope with groupId for per-group message isolation
  const context = useMemo<MessageMapKeyInput>(
    () => ({
      agentId,
      scope: 'group_agent_builder',
      topicId: activeTopicId,
    }),
    [agentId, activeTopicId],
  );

  // Get messages from ChatStore based on context
  const chatKey = useMemo(
    () => (context ? messageMapKey(context) : null),
    [context?.agentId, context?.groupId, context?.topicId],
  );

  const replaceMessages = useChatStore((s) => s.replaceMessages);
  const messages = useChatStore((s) => (chatKey ? s.dbMessagesMap[chatKey] : undefined));

  // Get operation state for reactive updates
  const operationState = useOperationState(context);

  return (
    <ConversationProvider
      context={context}
      hasInitMessages={!!messages}
      messages={messages}
      operationState={operationState}
      onMessagesChange={(msgs, ctx) => {
        replaceMessages(msgs, { context: ctx });
      }}
    >
      {children}
    </ConversationProvider>
  );
});

export default AgentBuilderProvider;

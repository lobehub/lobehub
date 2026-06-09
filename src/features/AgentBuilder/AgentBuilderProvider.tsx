import { type ReactNode } from 'react';
import { memo, useEffect, useMemo } from 'react';

import { ConversationProvider } from '@/features/Conversation';
import { useOperationState } from '@/hooks/useOperationState';
import { useChatStore } from '@/store/chat';
import { type MessageMapKeyInput } from '@/store/chat/utils/messageMapKey';
import { messageMapKey } from '@/store/chat/utils/messageMapKey';

interface AgentBuilderProviderProps {
  agentId: string;
  children: ReactNode;
  /**
   * The ID of the agent currently being edited in the profile page.
   * This is synced to chatStore.activeAgentId so the chat service can read it
   * when building the agentBuilderContext for injection into the LLM prompt.
   */
  editingAgentId?: string;
}

/**
 * Agent Builder Conversation Provider
 * Provides context for the Agent Builder chat panel
 * Uses 'agent_builder' scope to isolate messages from main conversation
 */
const AgentBuilderProvider = memo<AgentBuilderProviderProps>(
  ({ agentId, editingAgentId, children }) => {
    const activeTopicId = useChatStore((s) => s.activeTopicId);

    // Keep chatStore.activeAgentId in sync with the agent being edited.
    // The chat service reads getChatStoreState().activeAgentId to build agentBuilderContext,
    // so this must reflect the profile page agent, not the Agent Builder builtin agent.
    useEffect(() => {
      if (!editingAgentId) return;
      if (useChatStore.getState().activeAgentId === editingAgentId) return;
      useChatStore.setState(
        { activeAgentId: editingAgentId },
        false,
        'AgentBuilderProvider/syncEditingAgentId',
      );
    }, [editingAgentId]);

    // Build conversation context for agent builder
    // Using agent_builder scope for message management
    const context = useMemo<MessageMapKeyInput>(
      () => ({
        agentId,
        scope: 'agent_builder',
        topicId: activeTopicId,
      }),
      [agentId, activeTopicId],
    );

    // Get messages from ChatStore based on context
    const chatKey = useMemo(
      () => (context ? messageMapKey(context) : null),
      [context?.agentId, context?.topicId],
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
  },
);

export default AgentBuilderProvider;

import { type ReactNode } from 'react';
import { memo, useMemo } from 'react';

import { ConversationProvider } from '@/features/Conversation';
import { useOperationState } from '@/hooks/useOperationState';
import { useAgentStore } from '@/store/agent';
import { useChatStore } from '@/store/chat';
import { type MessageMapKeyInput } from '@/store/chat/utils/messageMapKey';
import { messageMapKey } from '@/store/chat/utils/messageMapKey';

interface PageAgentProviderProps {
  children: ReactNode;
  pageAgentId: string;
}
const PageAgentProvider = memo<PageAgentProviderProps>(({ pageAgentId, children }) => {
  const activeTopicId = useChatStore((s) => s.activeTopicId);
  const [activeAgentId, agentMap] = useAgentStore((s) => [s.activeAgentId, s.agentMap]);

  // Build conversation context for page agent
  // Using topic dimension for message management (1 agent can have multiple topics)
  // Use activeAgentId only if it exists in agentMap (is loaded), otherwise fall back to pageAgentId
  const selectedAgentId = useMemo(() => {
    if (activeAgentId && agentMap[activeAgentId]) {
      return activeAgentId;
    }
    return pageAgentId;
  }, [activeAgentId, agentMap, pageAgentId]);

  const context = useMemo<MessageMapKeyInput>(
    () => ({
      agentId: selectedAgentId,
      scope: 'page',
      topicId: activeTopicId, // No topic initially, can be extended later
    }),
    [selectedAgentId, activeTopicId],
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
});

export default PageAgentProvider;

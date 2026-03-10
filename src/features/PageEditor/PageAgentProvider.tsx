import { BUILTIN_AGENT_SLUGS } from '@lobechat/builtin-agents';
import { isChatGroupSessionId } from '@lobechat/types';
import { type ReactNode } from 'react';
import { memo, useMemo } from 'react';

import Loading from '@/components/Loading/BrandTextLoading';
import { ConversationProvider } from '@/features/Conversation';
import { useOperationState } from '@/hooks/useOperationState';
import { useAgentStore } from '@/store/agent';
import { builtinAgentSelectors } from '@/store/agent/selectors';
import { useChatStore } from '@/store/chat';
import { type MessageMapKeyInput } from '@/store/chat/utils/messageMapKey';
import { messageMapKey } from '@/store/chat/utils/messageMapKey';

interface PageAgentProviderProps {
  children: ReactNode;
}

export const PageAgentProvider = memo<PageAgentProviderProps>(({ children }) => {
  const useInitBuiltinAgent = useAgentStore((s) => s.useInitBuiltinAgent);
  const pageAgentId = useAgentStore(builtinAgentSelectors.pageAgentId);
  const activeTopicId = useChatStore((s) => s.activeTopicId);
  const activeAgentId = useAgentStore((s) => s.activeAgentId);

  useInitBuiltinAgent(BUILTIN_AGENT_SLUGS.pageAgent);

  // Build conversation context for page agent.
  // Ignore chat-group ids in page scope and fall back to page agent.
  const selectedAgentId =
    !activeAgentId || isChatGroupSessionId(activeAgentId) ? pageAgentId : activeAgentId;

  const context = useMemo<MessageMapKeyInput>(
    () => ({
      agentId: selectedAgentId,
      scope: 'page',
      topicId: activeTopicId, // No topic initially, can be extended later
    }),
    [selectedAgentId, activeTopicId],
  );

  // Get messages from ChatStore based on context
  const chatKey = useMemo(() => messageMapKey(context), [context]);
  const replaceMessages = useChatStore((s) => s.replaceMessages);
  const messages = useChatStore((s) => (chatKey ? s.dbMessagesMap[chatKey] : undefined));

  // Get operation state for reactive updates
  const operationState = useOperationState(context);

  if (!pageAgentId) return <Loading debugId="PageAgentProvider" />;

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

'use client';

import { Flexbox } from '@lobehub/ui';
import { memo, Suspense, useMemo } from 'react';

import {
  ChatInput,
  ChatList,
  type ConversationContext,
  type ConversationHooks,
  ConversationProvider,
} from '@/features/Conversation';
import SkeletonList from '@/features/Conversation/components/SkeletonList';
import { useChatFollowUp } from '@/features/Conversation/hooks/useChatFollowUp';
import { useGatewayReconnect } from '@/hooks/useGatewayReconnect';
import { useOperationState } from '@/hooks/useOperationState';
import { useAgentStore } from '@/store/agent';
import { agentByIdSelectors, chatConfigByIdSelectors } from '@/store/agent/selectors';
import { useChatStore } from '@/store/chat';
import { chatPortalSelectors, topicSelectors } from '@/store/chat/selectors';
import { messageMapKey } from '@/store/chat/utils/messageMapKey';

/**
 * Topic Chat Component
 *
 * Renders a *second*, side-by-side conversation in the portal: the main column
 * keeps rendering `activeTopicId`, while this pane renders a different topic
 * (dragged in from the sidebar or opened via the row menu) under the same
 * agent. Because everything is keyed by `messageMapKey(context)`, the two panes
 * load and stream independently and each can reply on its own.
 */
const TopicChat = memo(() => {
  const [activeAgentId, portalTopicId] = useChatStore((s) => [
    s.activeAgentId,
    chatPortalSelectors.portalTopicId(s),
  ]);

  const context: ConversationContext = useMemo(
    () => ({
      agentId: activeAgentId,
      scope: 'main',
      topicId: portalTopicId,
    }),
    [activeAgentId, portalTopicId],
  );

  const chatKey = useMemo(() => messageMapKey(context), [context]);
  const replaceMessages = useChatStore((s) => s.replaceMessages);
  const messages = useChatStore((s) => s.dbMessagesMap[chatKey]);

  const operationState = useOperationState(context);

  const isHeterogeneousAgent = useAgentStore(
    agentByIdSelectors.isAgentHeterogeneousById(activeAgentId),
  );

  // Live-stream a topic that is already running when it's dragged in.
  const runningOperation = useChatStore((s) =>
    portalTopicId
      ? topicSelectors.getTopicById(portalTopicId)(s)?.metadata?.runningOperation
      : undefined,
  );
  useGatewayReconnect(portalTopicId, runningOperation);

  const agentChatConfig = useAgentStore(chatConfigByIdSelectors.getChatConfigById(activeAgentId));
  const hooks: ConversationHooks = useChatFollowUp({
    agentChatConfig,
    conversationKey: chatKey,
    topicId: portalTopicId ?? undefined,
  });

  if (!portalTopicId) return null;

  return (
    <ConversationProvider
      context={context}
      hasInitMessages={!!messages}
      hooks={hooks}
      messages={messages}
      operationState={operationState}
      onMessagesChange={(msgs, ctx, meta) => {
        replaceMessages(msgs, { context: ctx, source: meta?.source });
      }}
    >
      <Suspense
        fallback={
          <Flexbox flex={1} height={'100%'}>
            <SkeletonList />
          </Flexbox>
        }
      >
        <Flexbox
          flex={1}
          width={'100%'}
          style={{
            overflowX: 'hidden',
            overflowY: 'auto',
            position: 'relative',
          }}
        >
          <ChatList
            defaultWorkflowExpandLevel={isHeterogeneousAgent ? { streaming: 'full' } : undefined}
          />
        </Flexbox>
      </Suspense>
      <ChatInput leftActions={['typo']} rightActions={['contextWindow']} />
    </ConversationProvider>
  );
});

TopicChat.displayName = 'TopicChat';

export default TopicChat;

'use client';

import { Flexbox } from '@lobehub/ui';
import { cssVar } from 'antd-style';
import { memo, Suspense, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import {
  TopicMigrationPlaceholder,
  useTopicMigrationPending,
} from '@/features/AgentTransferMigration';
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
import HeterogeneousChatInput from '@/routes/(main)/agent/features/Conversation/HeterogeneousChatInput';
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
  const { t } = useTranslation('chat');
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

  // Same gate as the main conversation: a topic still awaiting its transfer
  // backfill shows a placeholder instead of an empty history and blocks
  // sending — the server could not assemble the missing context anyway.
  const { job: migrationJob, topicPending } = useTopicMigrationPending(
    { agentId: activeAgentId },
    portalTopicId,
  );

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
          {topicPending ? (
            <TopicMigrationPlaceholder agentId={activeAgentId} topicId={portalTopicId} />
          ) : (
            <ChatList />
          )}
        </Flexbox>
      </Suspense>
      {topicPending ? (
        <Flexbox horizontal align={'center'} justify={'center'} paddingBlock={6} paddingInline={16}>
          <span style={{ color: cssVar.colorTextDescription, fontSize: 12, textAlign: 'center' }}>
            {t(
              migrationJob?.type === 'copy'
                ? 'transferMigration.inputDisabledHintCopy'
                : 'transferMigration.inputDisabledHint',
            )}
          </span>
        </Flexbox>
      ) : isHeterogeneousAgent ? (
        <HeterogeneousChatInput />
      ) : (
        <ChatInput leftActions={['typo']} rightActions={['contextWindow']} />
      )}
    </ConversationProvider>
  );
});

TopicChat.displayName = 'TopicChat';

export default TopicChat;

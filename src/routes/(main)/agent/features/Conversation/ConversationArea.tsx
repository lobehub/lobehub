'use client';

import { Flexbox } from '@lobehub/ui';
import { createStaticStyles, cssVar } from 'antd-style';
import debug from 'debug';
import { memo, Suspense, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { useBusinessConversationAnalytics } from '@/business/client/hooks/useBusinessConversationAnalytics';
import AgentHome from '@/features/AgentHome';
import ChatMiniMap from '@/features/ChatMiniMap';
import { ChatList, ConversationProvider } from '@/features/Conversation';
import ComposerDraftReceiver from '@/features/Conversation/ComposerDraftReceiver';
import { useChatFollowUp } from '@/features/Conversation/hooks/useChatFollowUp';
import {
  ForwardMessageDispatcher,
  MessageForwardFooter,
} from '@/features/Conversation/MessageForward';
import { mergeConversationHooks } from '@/features/Conversation/utils/mergeConversationHooks';
import { useGatewayReconnect } from '@/hooks/useGatewayReconnect';
import { useOperationState } from '@/hooks/useOperationState';
import { useAgentStore } from '@/store/agent';
import { agentByIdSelectors, chatConfigByIdSelectors } from '@/store/agent/selectors';
import { useChatStore } from '@/store/chat';
import { threadSelectors, topicSelectors } from '@/store/chat/selectors';
import { messageMapKey } from '@/store/chat/utils/messageMapKey';

import ExposeMainEditor from './ExposeMainEditor';
import HeterogeneousChatInput from './HeterogeneousChatInput';
import MainChatInput from './MainChatInput';
import MessageFromUrl from './MainChatInput/MessageFromUrl';
import ThreadHydration from './ThreadHydration';
import { useActionsBarConfig } from './useActionsBarConfig';
import { useAgentContext } from './useAgentContext';

const log = debug('lobe-render:agent:ConversationArea');

const styles = createStaticStyles(({ css }) => ({
  // When the chat column is wide enough for the header to float above the
  // full-bleed list (see Conversation/Header), this in-list spacer keeps the
  // first message clear of it while still letting content scroll underneath.
  // A list row is used instead of scroller padding, which breaks virtua's
  // offset math. Height matches the 44px NavHeader.
  floatingHeaderSpacer: css`
    height: 0;

    @container agent-chat-layout (min-width: 1200px) {
      height: 44px;
    }
  `,
}));

/**
 * ConversationArea
 *
 * Main conversation area component using the new ConversationStore architecture.
 * Uses ChatList from @/features/Conversation and MainChatInput for custom features.
 */
const Conversation = memo(() => {
  const { t } = useTranslation('chat');
  const context = useAgentContext();

  // Get raw dbMessages from ChatStore for this context
  // ConversationStore will parse them internally to generate displayMessages
  const chatKey = useMemo(
    () => messageMapKey(context),
    [context.agentId, context.topicId, context.threadId],
  );
  const replaceMessages = useChatStore((s) => s.replaceMessages);
  const messages = useChatStore((s) => s.dbMessagesMap[chatKey]);

  log('contextKey %s: %o', chatKey, messages);

  // Get operation state from ChatStore for reactive updates
  const operationState = useOperationState(context);

  // Get actionsBar config with branching support from ChatStore
  const actionsBarConfig = useActionsBarConfig();

  // Heterogeneous agents (Claude Code, etc.) use a simplified input — their
  // toolchain/memory/model are managed by the external runtime, so LobeHub's
  // model/tools/memory/KB/MCP/runtime-mode pickers don't apply.
  const isHeterogeneousAgent = useAgentStore(
    agentByIdSelectors.isAgentHeterogeneousById(context.agentId),
  );

  // Subagent threads (spawned by an external agent's subagent tool call) are
  // read-only — the parent agent drives their execution, so hide the input.
  const isSubagentThread = useChatStore(threadSelectors.isActiveThreadSubagent);

  // Auto-reconnect to running Gateway operation on topic load
  const runningOperation = useChatStore((s) =>
    context.topicId
      ? topicSelectors.getTopicById(context.topicId)(s)?.metadata?.runningOperation
      : undefined,
  );
  useGatewayReconnect(context.topicId, runningOperation);

  const agentChatConfig = useAgentStore(chatConfigByIdSelectors.getChatConfigById(context.agentId));
  const chatFollowUpHooks = useChatFollowUp({
    agentChatConfig,
    conversationKey: chatKey,
    threadId: context.threadId ?? undefined,
    topicId: context.topicId ?? undefined,
  });
  const businessAnalyticsHooks = useBusinessConversationAnalytics(context);

  const hooks = useMemo(
    () => mergeConversationHooks(businessAnalyticsHooks, chatFollowUpHooks),
    [businessAnalyticsHooks, chatFollowUpHooks],
  );

  return (
    <ConversationProvider
      actionsBar={actionsBarConfig}
      context={context}
      hasInitMessages={!!messages}
      hooks={hooks}
      messages={messages}
      operationState={operationState}
      onMessagesChange={(messages, ctx) => {
        replaceMessages(messages, { context: ctx });
      }}
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
          headerSlot={<div aria-hidden className={styles.floatingHeaderSpacer} />}
          welcome={<AgentHome />}
          footerSlot={
            isSubagentThread ? (
              <Flexbox
                horizontal
                align={'center'}
                justify={'center'}
                paddingBlock={6}
                paddingInline={16}
              >
                <span
                  style={{
                    color: cssVar.colorTextDescription,
                    fontSize: 12,
                    textAlign: 'center',
                  }}
                >
                  {t('thread.subagentReadOnlyHint')}
                </span>
              </Flexbox>
            ) : undefined
          }
        />
      </Flexbox>
      {!isSubagentThread && (
        <MessageForwardFooter>
          {isHeterogeneousAgent ? <HeterogeneousChatInput /> : <MainChatInput />}
        </MessageForwardFooter>
      )}
      <ExposeMainEditor />
      <ComposerDraftReceiver />
      <ThreadHydration />
      <ChatMiniMap />
      <ForwardMessageDispatcher />
      <Suspense>
        <MessageFromUrl />
      </Suspense>
    </ConversationProvider>
  );
});

Conversation.displayName = 'ConversationArea';

export default Conversation;

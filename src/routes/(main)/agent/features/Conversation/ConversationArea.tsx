'use client';

import { Flexbox } from '@lobehub/ui';
import debug from 'debug';
import { memo, Suspense, useMemo } from 'react';

import AgentHome from '@/features/AgentHome';
import ChatMiniMap from '@/features/ChatMiniMap';
import { ChatList, ConversationProvider, TodoProgress } from '@/features/Conversation';
import ZenModeToast from '@/features/ZenModeToast';
import { useOperationState } from '@/hooks/useOperationState';
import { useAgentStore } from '@/store/agent';
import { agentSelectors } from '@/store/agent/selectors';
import { useChatStore } from '@/store/chat';
import { messageMapKey } from '@/store/chat/utils/messageMapKey';

import ChatHydration from './ChatHydration';
import HeterogeneousChatInput from './HeterogeneousChatInput';
import MainChatInput from './MainChatInput';
import MessageFromUrl from './MainChatInput/MessageFromUrl';
import ThreadHydration from './ThreadHydration';
import { useActionsBarConfig } from './useActionsBarConfig';
import { useAgentContext } from './useAgentContext';
import { useGatewayReconnect } from './useGatewayReconnect';

const log = debug('lobe-render:agent:ConversationArea');

/**
 * ConversationArea
 *
 * Main conversation area component using the new ConversationStore architecture.
 * Uses ChatList from @/features/Conversation and MainChatInput for custom features.
 */
const Conversation = memo(() => {
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
  const isHeterogeneousAgent = useAgentStore(agentSelectors.isCurrentAgentHeterogeneous);

  // Auto-reconnect to running Gateway operation on topic load
  useGatewayReconnect(context.topicId);

  return (
    <ConversationProvider
      actionsBar={actionsBarConfig}
      context={context}
      hasInitMessages={!!messages}
      messages={messages}
      operationState={operationState}
      onMessagesChange={(messages, ctx) => {
        replaceMessages(messages, { context: ctx });
      }}
    >
      <ZenModeToast />
      <Flexbox
        flex={1}
        width={'100%'}
        style={{
          overflowX: 'hidden',
          overflowY: 'auto',
          position: 'relative',
        }}
      >
        <ChatList welcome={<AgentHome />} />
      </Flexbox>
      <TodoProgress />
      {isHeterogeneousAgent ? <HeterogeneousChatInput /> : <MainChatInput />}
      <ChatHydration />
      <ThreadHydration />
      <ChatMiniMap />
      <Suspense>
        <MessageFromUrl />
      </Suspense>
    </ConversationProvider>
  );
});

Conversation.displayName = 'ConversationArea';

export default Conversation;

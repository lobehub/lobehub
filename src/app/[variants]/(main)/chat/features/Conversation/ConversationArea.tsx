'use client';

import { Flexbox } from '@lobehub/ui';
import { Suspense, memo, useEffect, useMemo } from 'react';

import ChatMiniMap from '@/features/ChatMiniMap';
import { ChatList, ConversationProvider, TodoProgress } from '@/features/Conversation';
import ZenModeToast from '@/features/ZenModeToast';
import { useOperationState } from '@/hooks/useOperationState';
import { useAgentStore } from '@/store/agent';
import { agentSelectors } from '@/store/agent/selectors';
import { useChatStore } from '@/store/chat';
import { topicSelectors } from '@/store/chat/selectors';
import { messageMapKey } from '@/store/chat/utils/messageMapKey';
import { useUserStore } from '@/store/user';
import { settingsSelectors } from '@/store/user/selectors';
import { useUserMemoryStore } from '@/store/userMemory';

import WelcomeChatItem from './AgentWelcome';
import ChatHydration from './ChatHydration';
import MainChatInput from './MainChatInput';
import MessageFromUrl from './MainChatInput/MessageFromUrl';
import ThreadHydration from './ThreadHydration';
import { useActionsBarConfig } from './useActionsBarConfig';
import { useAgentContext } from './useAgentContext';

/**
 * ConversationArea
 *
 * Main conversation area component using the new ConversationStore architecture.
 * Uses ChatList from @/features/Conversation and MainChatInput for custom features.
 */
const Conversation = memo(() => {
  const context = useAgentContext();

  const [useFetchUserMemory, setActiveMemoryContext] = useUserMemoryStore((s) => [
    s.useFetchUserMemory,
    s.setActiveMemoryContext,
  ]);
  const [currentAgentMeta, activeTopic] = [
    useAgentStore(agentSelectors.currentAgentMeta),
    useChatStore(topicSelectors.currentActiveTopic),
  ];
  const enableUserMemories = useUserStore(settingsSelectors.memoryEnabled);

  useEffect(() => {
    if (!enableUserMemories) {
      setActiveMemoryContext(undefined);
      return;
    }

    setActiveMemoryContext({ agent: currentAgentMeta, topic: activeTopic });
  }, [activeTopic, currentAgentMeta, enableUserMemories, setActiveMemoryContext]);

  useFetchUserMemory(Boolean(enableUserMemories && context.agentId));

  // Get raw dbMessages from ChatStore for this context
  // ConversationStore will parse them internally to generate displayMessages
  const chatKey = useMemo(
    () => messageMapKey(context),
    [context.agentId, context.topicId, context.threadId],
  );
  const replaceMessages = useChatStore((s) => s.replaceMessages);
  const messages = useChatStore((s) => s.dbMessagesMap[chatKey]);

  // Get operation state from ChatStore for reactive updates
  const operationState = useOperationState(context);

  // Get actionsBar config with branching support from ChatStore
  const actionsBarConfig = useActionsBarConfig();

  return (
    <ConversationProvider
      actionsBar={actionsBarConfig}
      context={context}
      hasInitMessages={!!messages}
      messages={messages}
      onMessagesChange={(messages) => {
        replaceMessages(messages, { context });
      }}
      operationState={operationState}
    >
      <ZenModeToast />
      <Flexbox
        flex={1}
        style={{
          overflowX: 'hidden',
          overflowY: 'auto',
          position: 'relative',
        }}
        width={'100%'}
      >
        <ChatList welcome={<WelcomeChatItem />} />
      </Flexbox>
      <TodoProgress />
      <MainChatInput />
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

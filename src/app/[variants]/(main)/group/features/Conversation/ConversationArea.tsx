'use client';

import { Flexbox } from '@lobehub/ui';
import { Suspense, memo, useMemo } from 'react';

import ChatMiniMap from '@/features/ChatMiniMap';
import { ChatList, ConversationProvider } from '@/features/Conversation';
import ZenModeToast from '@/features/ZenModeToast';
import { useOperationState } from '@/hooks/useOperationState';
import { useChatStore } from '@/store/chat';
import { messageMapKey } from '@/store/chat/utils/messageMapKey';

import WelcomeChatItem from './AgentWelcome';
import ChatHydration from './ChatHydration';
import MainChatInput from './MainChatInput';
import MessageFromUrl from './MainChatInput/MessageFromUrl';
import ThreadHydration from './ThreadHydration';
import { useActionsBarConfig } from './useActionsBarConfig';
import { useGroupContext } from './useGroupContext';

// import { useGroupHooks } from './useGroupHooks';

interface ConversationAreaProps {
  mobile?: boolean;
}

/**
 * ConversationArea
 *
 * Main conversation area component using the new ConversationStore architecture.
 * Uses ChatList from @/features/Conversation and MainChatInput for custom features.
 */
const Conversation = memo<ConversationAreaProps>(({ mobile = false }) => {
  const context = useGroupContext();

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

  // Get group-specific hooks for send logic
  // const groupHooks = useGroupHooks(context);

  return (
    <ConversationProvider
      actionsBar={actionsBarConfig}
      context={context}
      hasInitMessages={!!messages}
      // hooks={groupHooks}
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
      <MainChatInput />
      <ChatHydration />
      <ThreadHydration />
      {!mobile && (
        <>
          <ChatMiniMap />
          <Suspense>
            <MessageFromUrl />
          </Suspense>
        </>
      )}
    </ConversationProvider>
  );
});

Conversation.displayName = 'ConversationArea';

export default Conversation;

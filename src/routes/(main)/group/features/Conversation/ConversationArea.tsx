'use client';

import { Flexbox } from '@lobehub/ui';
import { cssVar } from 'antd-style';
import { memo, Suspense } from 'react';
import { useTranslation } from 'react-i18next';

import {
  TopicMigrationPlaceholder,
  useTopicMigrationPending,
} from '@/features/AgentTransferMigration';
import ChatMiniMap from '@/features/ChatMiniMap';
import { ChatList, ConversationProvider } from '@/features/Conversation';
import { useMessageDeepLink } from '@/features/Conversation/ChatList/hooks/useMessageDeepLink';
import {
  ForwardMessageDispatcher,
  MessageForwardFooter,
} from '@/features/Conversation/MessageForward';
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
  const { t } = useTranslation('chat');
  const context = useGroupContext();
  const messageDeepLink = useMessageDeepLink();

  // Get raw dbMessages from ChatStore for this context
  // ConversationStore will parse them internally to generate displayMessages
  const chatKey = messageMapKey(context);
  const replaceMessages = useChatStore((s) => s.replaceMessages);
  const messages = useChatStore((s) => s.dbMessagesMap[chatKey]);

  // Get operation state from ChatStore for reactive updates
  const operationState = useOperationState(context);

  const actionsBarConfig = useActionsBarConfig();

  // A topic still awaiting its transfer/copy backfill shows a placeholder
  // instead of an empty (not-yet-migrated) history, and blocks sending — the
  // supervisor could not assemble the missing context anyway. Opening it jumps
  // it to the front of the queue, so the wait is typically a few seconds.
  const { job: migrationJob, topicPending } = useTopicMigrationPending(
    { groupId: context.groupId },
    context.topicId,
  );

  return (
    <ConversationProvider
      actionsBar={actionsBarConfig}
      context={context}
      hasInitMessages={!!messages}
      messages={messages}
      operationState={operationState}
      onMessagesChange={(messages, ctx, meta) => {
        replaceMessages(messages, { context: ctx, source: meta?.source });
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
        {topicPending ? (
          <TopicMigrationPlaceholder groupId={context.groupId} topicId={context.topicId} />
        ) : (
          <ChatList messageDeepLink={messageDeepLink} welcome={<WelcomeChatItem />} />
        )}
      </Flexbox>
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
      ) : (
        <MessageForwardFooter>
          <MainChatInput />
        </MessageForwardFooter>
      )}
      <ChatHydration />
      <ThreadHydration />
      <ForwardMessageDispatcher />
      {!mobile && (
        <>
          <ChatMiniMap />
          {/* Held back while the topic is still migrating: the composer above is
              already disabled, and letting `?message=` through would send into
              the not-yet-migrated history this screen is waiting for. The param
              stays in the URL, so the send fires once the backfill lands. */}
          {!topicPending && (
            <Suspense>
              <MessageFromUrl />
            </Suspense>
          )}
        </>
      )}
    </ConversationProvider>
  );
});

Conversation.displayName = 'ConversationArea';

export default Conversation;

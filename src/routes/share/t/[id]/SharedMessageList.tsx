'use client';

import { Flexbox, Text } from '@lobehub/ui';
import { memo, type ReactNode, useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { ChatList, ConversationProvider, MessageItem } from '@/features/Conversation';
import { useChatStore } from '@/store/chat';
import { messageMapKey } from '@/store/chat/utils/messageMapKey';

interface SharedMessageListProps {
  agentId: string | null;
  groupId: string | null;
  headerSlot?: ReactNode;
  shareId: string;
  topicId: string;
}

const SharedMessageList = memo<SharedMessageListProps>((props) => {
  const { agentId, groupId, headerSlot, shareId, topicId } = props;
  const { t } = useTranslation('chat');
  const context = useMemo(
    () => ({
      agentId: agentId ?? '',
      groupId: groupId ?? undefined,
      topicId,
      topicShareId: shareId,
    }),
    [agentId, groupId, shareId, topicId],
  );

  // Sync messages to chatStore for artifact selectors to work
  const chatKey = useMemo(() => messageMapKey(context), [context]);
  const replaceMessages = useChatStore((s) => s.replaceMessages);
  const messages = useChatStore((s) => s.dbMessagesMap[chatKey]);

  const itemContent = useCallback(
    (index: number, id: string) => <MessageItem disableEditing id={id} index={index} key={id} />,
    [],
  );

  return (
    <ConversationProvider
      context={context}
      hasInitMessages={!!messages}
      messages={messages}
      onMessagesChange={(messages, ctx) => {
        replaceMessages(messages, { context: ctx });
      }}
    >
      <ChatList
        disableActionsBar
        headerSlot={headerSlot}
        itemContent={itemContent}
        footerSlot={
          <Flexbox align={'center'} paddingBlock={'16px 80px'} paddingInline={24}>
            <Text fontSize={12} style={{ maxWidth: 480, textAlign: 'center' }} type={'secondary'}>
              {t('sharePageDisclaimer')}
            </Text>
          </Flexbox>
        }
      />
    </ConversationProvider>
  );
});

export default SharedMessageList;

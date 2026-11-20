'use client';

import { BRANDING_NAME } from '@lobechat/business-const';
import { Flexbox, Text } from '@lobehub/ui';
import { memo, type ReactNode, useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { ChatList, ConversationProvider, MessageItem } from '@/features/Conversation';

import { type SharedTopicReadMode, toSharedConversationContext } from './sharedConversation';

interface SharedMessageListProps {
  agentId: string | null;
  groupId: string | null;
  headerSlot?: ReactNode;
  messageReadMode: SharedTopicReadMode;
  shareId: string;
  topicId: string;
}

const SharedMessageList = memo<SharedMessageListProps>((props) => {
  const { agentId, groupId, headerSlot, messageReadMode, shareId, topicId } = props;
  const { t } = useTranslation('chat');
  const [newestFirstShareId, setNewestFirstShareId] = useState<string>();
  const readMode = newestFirstShareId === shareId ? 'backward' : messageReadMode;
  const context = useMemo(
    () => toSharedConversationContext({ agentId, groupId, shareId, topicId }, readMode),
    [agentId, groupId, readMode, shareId, topicId],
  );
  const readNewestFirst = useCallback(() => setNewestFirstShareId(shareId), [shareId]);

  const itemContent = useCallback(
    (index: number, id: string) => <MessageItem disableEditing id={id} index={index} key={id} />,
    [],
  );

  return (
    <ConversationProvider context={context}>
      <ChatList
        disableActionsBar
        rememberReadingPosition
        headerSlot={headerSlot}
        initialScrollPosition={'top'}
        itemContent={itemContent}
        footerSlot={
          <Flexbox align={'center'} paddingBlock={24} paddingInline={24}>
            <Text fontSize={12} style={{ maxWidth: 480, textAlign: 'center' }} type={'secondary'}>
              {t('sharePageDisclaimer', { appName: BRANDING_NAME })}
            </Text>
          </Flexbox>
        }
        onForwardPagingUnsupported={readNewestFirst}
      />
    </ConversationProvider>
  );
});

export default SharedMessageList;

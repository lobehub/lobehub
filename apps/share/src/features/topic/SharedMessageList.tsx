'use client';

import { BRANDING_NAME } from '@lobechat/business-const';
import { Flexbox, Text } from '@lobehub/ui';
import { memo, type ReactNode, useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { ChatList, ConversationProvider, MessageItem } from '@/features/Conversation';

import { toSharedConversationContext } from './sharedConversation';

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
    () => toSharedConversationContext({ agentId, groupId, shareId, topicId }),
    [agentId, groupId, shareId, topicId],
  );

  const itemContent = useCallback(
    (index: number, id: string) => <MessageItem disableEditing id={id} index={index} key={id} />,
    [],
  );

  return (
    <ConversationProvider context={context}>
      <ChatList
        disableActionsBar
        headerSlot={headerSlot}
        itemContent={itemContent}
        footerSlot={
          <Flexbox align={'center'} paddingBlock={24} paddingInline={24}>
            <Text fontSize={12} style={{ maxWidth: 480, textAlign: 'center' }} type={'secondary'}>
              {t('sharePageDisclaimer', { appName: BRANDING_NAME })}
            </Text>
          </Flexbox>
        }
      />
    </ConversationProvider>
  );
});

export default SharedMessageList;

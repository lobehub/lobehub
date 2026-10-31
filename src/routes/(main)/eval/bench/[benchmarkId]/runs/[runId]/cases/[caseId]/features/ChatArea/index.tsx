'use client';

import { Flexbox, Text } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { memo, useCallback } from 'react';
import { useTranslation } from 'react-i18next';

import { ChatList, ConversationProvider } from '@/features/Conversation';
import MessageItem from '@/features/Conversation/Messages';
import { useInitAgentConfig } from '@/hooks/useInitAgentConfig';

const styles = stylex.create({
  header: {
    flex: 'none',
    paddingBlock: '12px',
    paddingInline: '16px',
    borderBlockEndWidth: '1px',
    borderBlockEndStyle: 'solid',
    borderBlockEndColor: cssVar.colorBorderSecondary,
  },
  scroll: { position: 'relative', overflowX: 'hidden', overflowY: 'auto', flex: '1' },
});

interface ChatAreaProps {
  agentId: string;
  threadId?: string;
  topicId: string;
}

const ChatArea = memo<ChatAreaProps>(({ agentId, topicId, threadId }) => {
  const { t } = useTranslation('eval');
  useInitAgentConfig(agentId);

  const itemContent = useCallback(
    (index: number, id: string) => <MessageItem disableEditing id={id} index={index} />,
    [],
  );

  // Use threadId as part of key to force re-render when switching threads
  const contextKey = threadId ? `${topicId}-${threadId}` : topicId;

  return (
    <ConversationProvider context={{ agentId, threadId, topicId }} key={contextKey}>
      <Flexbox flex={1} style={{ minWidth: 0, overflow: 'hidden' }}>
        <Flexbox className={stylex.props(styles.header).className}>
          <Text fontSize={12} type={'secondary'} weight={500}>
            {t('caseDetail.chatArea.title')}
          </Text>
        </Flexbox>
        <Flexbox
          className={stylex.props(styles.scroll).className}
          onContextMenu={(e) => e.preventDefault()}
        >
          <ChatList disableActionsBar itemContent={itemContent} />
        </Flexbox>
      </Flexbox>
    </ConversationProvider>
  );
});

export default ChatArea;

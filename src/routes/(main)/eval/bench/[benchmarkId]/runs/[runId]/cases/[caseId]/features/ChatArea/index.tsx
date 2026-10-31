'use client';

import { createStaticStyles, cssVar, Flexbox, Text } from '@lobehub/ui';
import { memo, useCallback } from 'react';
import { useTranslation } from 'react-i18next';

import { ChatList, ConversationProvider } from '@/features/Conversation';
import MessageItem from '@/features/Conversation/Messages';
import { useInitAgentConfig } from '@/hooks/useInitAgentConfig';

const styles = createStaticStyles(({ css }) => ({
  header: css`
    flex: none;
    padding-block: 12px;
    padding-inline: 16px;
    border-block-end: 1px solid ${cssVar.colorBorderSecondary};
  `,
  scroll: css`
    position: relative;
    overflow: hidden auto;
    flex: 1;
  `,
}));

interface ChatAreaProps {
  agentId: string;
  /** Changes when the attempt's state does, so a page opened mid-run reloads the messages. */
  reloadKey?: string | null;
  threadId?: string;
  topicId: string;
}

const ChatArea = memo<ChatAreaProps>(({ agentId, topicId, threadId, reloadKey }) => {
  const { t } = useTranslation('eval');
  useInitAgentConfig(agentId);

  const itemContent = useCallback(
    (index: number, id: string) => <MessageItem disableEditing id={id} index={index} />,
    [],
  );

  // Use threadId as part of key to force re-render when switching threads; the
  // reload key does the same when the attempt finishes after the page opened.
  const contextKey = [topicId, threadId, reloadKey].filter(Boolean).join('-');

  return (
    <ConversationProvider context={{ agentId, threadId, topicId }} key={contextKey}>
      <Flexbox flex={1} style={{ minWidth: 0, overflow: 'hidden' }}>
        <Flexbox className={styles.header}>
          <Text fontSize={12} type={'secondary'} weight={500}>
            {t('caseDetail.chatArea.title')}
          </Text>
        </Flexbox>
        <Flexbox className={styles.scroll} onContextMenu={(e) => e.preventDefault()}>
          <ChatList disableActionsBar itemContent={itemContent} />
        </Flexbox>
      </Flexbox>
    </ConversationProvider>
  );
});

export default ChatArea;

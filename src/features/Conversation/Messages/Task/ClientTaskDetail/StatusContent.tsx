'use client';

import { type TaskDetail } from '@lobechat/types';
import { Block, Flexbox, ScrollShadow } from '@lobehub/ui';
import { createStaticStyles, cssVar } from 'antd-style';
import { memo, useMemo } from 'react';

import { useChatStore } from '@/store/chat';
import { displayMessageSelectors } from '@/store/chat/selectors';
import { messageMapKey } from '@/store/chat/utils/messageMapKey';

import ContentBlock from '../../AssistantGroup/components/ContentBlock';
import { InitializingState } from '../../Tasks/shared';

const styles = createStaticStyles(({ css }) => ({
  contentScroll: css`
    max-height: min(50vh, 400px);
  `,
}));

interface StatusContentProps {
  content?: string;
  messageId: string;
  taskDetail?: TaskDetail;
}

const StatusContent = memo<StatusContentProps>(({ taskDetail }) => {
  const threadId = taskDetail?.threadId;

  const [activeAgentId, activeTopicId] = useChatStore((s) => [s.activeAgentId, s.activeTopicId]);

  const threadMessageKey = useMemo(
    () =>
      threadId
        ? messageMapKey({
            agentId: activeAgentId,
            scope: 'thread',
            threadId,
            topicId: activeTopicId,
          })
        : null,
    [activeAgentId, activeTopicId, threadId],
  );

  // Get thread messages from store using selector
  const threadMessages = useChatStore((s) =>
    threadMessageKey ? displayMessageSelectors.getDisplayMessagesByKey(threadMessageKey)(s) : [],
  );

  // Initializing state: no status yet (task just created, waiting for client execution)
  if (threadMessages.length === 0) {
    return <InitializingState />;
  }

  // Find the assistantGroup message which contains the children blocks
  const assistantGroupMessage = threadMessages.find((item) => item.role === 'assistantGroup');
  const instruction = threadMessages.find((item) => item.role === 'user')?.content;

  if (!assistantGroupMessage?.children || assistantGroupMessage.children.length === 0) {
    return <InitializingState />;
  }

  return (
    <Flexbox>
      <Block padding={12} variant={'outlined'}>
        <span style={{ color: cssVar.colorTextSecondary }}>{instruction}</span>
      </Block>
      <ScrollShadow className={styles.contentScroll} offset={12} size={12}>
        <Flexbox gap={8}>
          {assistantGroupMessage.children.map((block) => (
            <ContentBlock
              {...block}
              assistantId={assistantGroupMessage.id}
              disableEditing
              key={block.id}
            />
          ))}
        </Flexbox>
      </ScrollShadow>
    </Flexbox>
  );
});

StatusContent.displayName = 'ClientStatusContent';

export default StatusContent;

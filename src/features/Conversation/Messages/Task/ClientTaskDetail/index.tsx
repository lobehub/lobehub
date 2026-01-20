'use client';

import { type TaskDetail, ThreadStatus } from '@lobechat/types';
import { Accordion, AccordionItem, Block, Flexbox, Icon, Markdown, Text } from '@lobehub/ui';
import { cssVar } from 'antd-style';
import { ScrollText } from 'lucide-react';
import { memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { useChatStore } from '@/store/chat';
import { displayMessageSelectors } from '@/store/chat/selectors';
import { messageMapKey } from '@/store/chat/utils/messageMapKey';

import CompletedState from './CompletedState';
import InitializingState from './InitializingState';
import ProcessingState from './ProcessingState';

interface ClientTaskDetailProps {
  content?: string;
  messageId: string;
  taskDetail?: TaskDetail;
}

const ClientTaskDetail = memo<ClientTaskDetailProps>(({ taskDetail }) => {
  const { t } = useTranslation('chat');
  const threadId = taskDetail?.threadId;
  const isExecuting = taskDetail?.status === ThreadStatus.Processing;

  const [activeAgentId, activeTopicId, useFetchMessages] = useChatStore((s) => [
    s.activeAgentId,
    s.activeTopicId,
    s.useFetchMessages,
  ]);

  const threadContext = useMemo(
    () => ({
      agentId: activeAgentId,
      scope: 'thread' as const,
      threadId,
      topicId: activeTopicId,
    }),
    [activeAgentId, activeTopicId, threadId],
  );

  const threadMessageKey = useMemo(
    () => (threadId ? messageMapKey(threadContext) : null),
    [threadId],
  );

  // Fetch thread messages (skip when executing - messages come from real-time updates)
  useFetchMessages(threadContext, isExecuting);

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
    <Flexbox gap={4}>
      {instruction && (
        <Accordion defaultExpandedKeys={['instruction']} gap={8}>
          <AccordionItem
            itemKey="instruction"
            paddingBlock={4}
            paddingInline={8}
            title={
              <Flexbox align="center" gap={8} horizontal>
                <Block
                  align="center"
                  flex="none"
                  gap={4}
                  height={24}
                  horizontal
                  justify="center"
                  style={{ fontSize: 12 }}
                  variant="outlined"
                  width={24}
                >
                  <Icon color={cssVar.colorTextSecondary} icon={ScrollText} />
                </Block>
                <Text as="span" type="secondary">
                  {t('task.instruction')}
                </Text>
              </Flexbox>
            }
          >
            <Block
              padding={12}
              style={{ marginBlock: 8, maxHeight: 300, overflow: 'auto' }}
              variant={'outlined'}
            >
              <Markdown variant={'chat'}>{instruction}</Markdown>
            </Block>
          </AccordionItem>
        </Accordion>
      )}

      {isExecuting ? (
        <ProcessingState
          assistantId={assistantGroupMessage.id}
          blocks={assistantGroupMessage.children}
        />
      ) : (
        <CompletedState
          assistantId={assistantGroupMessage.id}
          blocks={assistantGroupMessage.children}
        />
      )}
    </Flexbox>
  );
});

ClientTaskDetail.displayName = 'ClientClientTaskDetail';

export default ClientTaskDetail;

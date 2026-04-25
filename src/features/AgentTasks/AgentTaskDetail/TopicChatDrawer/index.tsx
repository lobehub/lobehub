'use client';

import { type ConversationContext } from '@lobechat/types';
import { Drawer, Flexbox, Text } from '@lobehub/ui';
import { cssVar } from 'antd-style';
import { memo, useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { ChatList, ConversationProvider, MessageItem } from '@/features/Conversation';
import { useOperationState } from '@/hooks/useOperationState';
import { useChatStore } from '@/store/chat';
import { messageMapKey } from '@/store/chat/utils/messageMapKey';
import { useTaskStore } from '@/store/task';
import { taskActivitySelectors, taskDetailSelectors } from '@/store/task/selectors';

import TopicStatusIcon from '../TopicStatusIcon';

interface TopicChatDrawerBodyProps {
  agentId: string;
  topicId: string;
}

const TopicChatDrawerBody = memo<TopicChatDrawerBodyProps>(({ agentId, topicId }) => {
  const context = useMemo<ConversationContext>(
    () => ({
      agentId,
      isolatedTopic: true,
      scope: 'main',
      topicId,
    }),
    [agentId, topicId],
  );

  const chatKey = messageMapKey(context);
  const messages = useChatStore((s) => s.dbMessagesMap[chatKey]);
  const replaceMessages = useChatStore((s) => s.replaceMessages);
  const operationState = useOperationState(context);

  const itemContent = useCallback(
    (index: number, id: string) => (
      <MessageItem
        disableEditing
        defaultWorkflowExpandLevel="full"
        id={id}
        index={index}
        key={id}
      />
    ),
    [],
  );

  return (
    <ConversationProvider
      context={context}
      hasInitMessages={!!messages}
      messages={messages}
      operationState={operationState}
      onMessagesChange={(msgs, ctx) => {
        replaceMessages(msgs, { context: ctx });
      }}
    >
      <Flexbox flex={1} height={'100%'} style={{ overflow: 'hidden' }}>
        <ChatList disableActionsBar itemContent={itemContent} />
      </Flexbox>
    </ConversationProvider>
  );
});

TopicChatDrawerBody.displayName = 'TopicChatDrawerBody';

const TopicChatDrawer = memo(() => {
  const { t } = useTranslation('chat');
  const topicId = useTaskStore(taskDetailSelectors.activeTopicDrawerTopicId);
  const agentId = useTaskStore(taskDetailSelectors.activeTaskAgentId);
  const activity = useTaskStore(taskActivitySelectors.activeDrawerTopicActivity);
  const closeTopicDrawer = useTaskStore((s) => s.closeTopicDrawer);

  const open = !!topicId && !!agentId;
  const status = activity?.status;

  const title = (
    <Flexbox horizontal align={'center'} gap={8} style={{ minWidth: 0 }}>
      <TopicStatusIcon size={16} status={status} />
      <Text ellipsis weight={500}>
        {activity?.title || t('taskDetail.topicDrawer.untitled')}
      </Text>
      {activity?.seq != null && (
        <Text fontSize={12} type={'secondary'}>
          #{activity.seq}
        </Text>
      )}
    </Flexbox>
  );

  return (
    <Drawer
      destroyOnHidden
      containerMaxWidth={'auto'}
      mask={false}
      open={open}
      placement={'right'}
      push={false}
      title={title}
      width={640}
      styles={{
        body: { padding: 0 },
        bodyContent: { height: '100%' },
        wrapper: {
          border: `1px solid ${cssVar.colorBorderSecondary}`,
          borderRadius: 12,
          bottom: 8,
          boxShadow: '0 6px 24px 0 rgba(0, 0, 0, 0.08), 0 2px 6px 0 rgba(0, 0, 0, 0.04)',
          height: 'auto',
          overflow: 'hidden',
          right: 8,
          top: 8,
        },
      }}
      onClose={closeTopicDrawer}
    >
      {open && <TopicChatDrawerBody agentId={agentId!} topicId={topicId!} />}
    </Drawer>
  );
});

TopicChatDrawer.displayName = 'TopicChatDrawer';

export default TopicChatDrawer;

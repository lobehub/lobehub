'use client';

import type { ConversationContext } from '@lobechat/types';
import type { DropdownItem } from '@lobehub/ui';
import { ActionIcon, copyToClipboard, Drawer, DropdownMenu, Flexbox, Text } from '@lobehub/ui';
import { cssVar } from 'antd-style';
import { Copy, MoreHorizontal, Share2 } from 'lucide-react';
import dynamic from 'next/dynamic';
import { memo, useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { ChatList, ConversationProvider, MessageItem } from '@/features/Conversation';
import { TaskCardScopeProvider } from '@/features/Conversation/Markdown/plugins/Task';
import { useShareModal } from '@/features/ShareModal';
import { useGatewayReconnect } from '@/hooks/useGatewayReconnect';
import { useOperationState } from '@/hooks/useOperationState';
import { useAgentStore } from '@/store/agent';
import { useChatStore } from '@/store/chat';
import { messageMapKey } from '@/store/chat/utils/messageMapKey';
import { useServerConfigStore } from '@/store/serverConfig';
import { serverConfigSelectors } from '@/store/serverConfig/selectors';
import { useTaskStore } from '@/store/task';
import { taskActivitySelectors, taskDetailSelectors } from '@/store/task/selectors';
import { useUserStore } from '@/store/user';
import { authSelectors } from '@/store/user/selectors';

import TopicStatusIcon from '../TopicStatusIcon';

const SharePopover = dynamic(() => import('@/features/SharePopover'));

interface TopicChatDrawerBodyProps {
  agentId: string;
  topicId: string;
}

const TopicChatDrawerBody = memo<TopicChatDrawerBodyProps>(({ agentId, topicId }) => {
  const isLogin = useUserStore(authSelectors.isLogin);
  const useHydrateAgentConfig = useAgentStore((s) => s.useHydrateAgentConfig);

  useHydrateAgentConfig(isLogin, agentId);

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

  const runningOperation = useTaskStore(
    (s) => taskActivitySelectors.activeDrawerTopicActivity(s)?.runningOperation,
  );
  useGatewayReconnect(topicId, runningOperation);

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
      <TaskCardScopeProvider value={true}>
        <Flexbox flex={1} height={'100%'} style={{ overflow: 'hidden' }}>
          <ChatList disableActionsBar itemContent={itemContent} />
        </Flexbox>
      </TaskCardScopeProvider>
    </ConversationProvider>
  );
});

TopicChatDrawerBody.displayName = 'TopicChatDrawerBody';

const TopicChatDrawer = memo(() => {
  const { t } = useTranslation(['chat', 'common']);
  const topicId = useTaskStore(taskDetailSelectors.activeTopicDrawerTopicId);
  const activeTaskId = useTaskStore((s) => s.activeTaskId);
  const agentId = useTaskStore(taskDetailSelectors.activeTaskAgentId);
  const activity = useTaskStore(taskActivitySelectors.activeDrawerTopicActivity);
  const closeTopicDrawer = useTaskStore((s) => s.closeTopicDrawer);
  const useFetchTaskDetail = useTaskStore((s) => s.useFetchTaskDetail);
  const enableTopicLinkShare = useServerConfigStore(serverConfigSelectors.enableBusinessFeatures);

  // Hydrate task detail when the drawer is opened outside of TaskDetailPage
  // (e.g. from a brief on home) so the header has agentId / status / seq.
  useFetchTaskDetail(topicId ? activeTaskId : undefined);

  const open = !!topicId && !!agentId;
  const status = activity?.status;

  const shareContext = useMemo<Partial<ConversationContext>>(
    () => ({ agentId: agentId ?? undefined, topicId: topicId ?? undefined }),
    [agentId, topicId],
  );
  const { openShareModal } = useShareModal({ context: shareContext });

  const handleCopyTopicId = useCallback(() => {
    if (topicId) void copyToClipboard(topicId);
  }, [topicId]);

  const handleCopyOperationId = useCallback(() => {
    if (activity?.operationId) void copyToClipboard(activity.operationId);
  }, [activity?.operationId]);

  const menuItems = useMemo<DropdownItem[]>(
    () => [
      {
        disabled: !topicId,
        icon: Copy,
        key: 'copyTopicId',
        label: t('taskDetail.topicMenu.copyId', { defaultValue: 'Copy topic ID' }),
        onClick: handleCopyTopicId,
      },
      {
        disabled: !activity?.operationId,
        icon: Copy,
        key: 'copyOperationId',
        label: t('taskDetail.topicMenu.copyOperationId', { defaultValue: 'Copy operation ID' }),
        onClick: handleCopyOperationId,
      },
    ],
    [t, topicId, activity?.operationId, handleCopyTopicId, handleCopyOperationId],
  );

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
      <DropdownMenu items={menuItems}>
        <ActionIcon icon={MoreHorizontal} size={'small'} />
      </DropdownMenu>
    </Flexbox>
  );

  const shareIcon = (
    <ActionIcon
      icon={Share2}
      size={'small'}
      title={t('share', { ns: 'common' })}
      onClick={enableTopicLinkShare ? undefined : openShareModal}
    />
  );

  const extra = topicId ? (
    enableTopicLinkShare ? (
      <SharePopover topicId={topicId} onOpenModal={openShareModal}>
        {shareIcon}
      </SharePopover>
    ) : (
      shareIcon
    )
  ) : null;

  return (
    <Drawer
      destroyOnHidden
      containerMaxWidth={'auto'}
      extra={extra}
      getContainer={false}
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

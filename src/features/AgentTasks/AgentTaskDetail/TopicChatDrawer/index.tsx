'use client';

import type { ConversationContext } from '@lobechat/types';
import type { DropdownItem } from '@lobehub/ui';
import {
  ActionIcon,
  copyToClipboard,
  DropdownMenu,
  Flexbox,
  Freeze,
  Tag,
  Text,
} from '@lobehub/ui';
import { FloatingPanel } from '@lobehub/ui/base-ui';
import { Copy, MoreHorizontal, Share2 } from 'lucide-react';
import { memo, useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { ChatList, ConversationProvider, MessageItem } from '@/features/Conversation';
import { TaskCardScopeProvider } from '@/features/Conversation/Markdown/plugins/Task';
import { useShareModal } from '@/features/ShareModal';
import { LazySharePopover as SharePopover } from '@/features/SharePopover/lazy';
import { useGatewayReconnect } from '@/hooks/useGatewayReconnect';
import { useOperationState } from '@/hooks/useOperationState';
import { usePermission } from '@/hooks/usePermission';
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
import FeedbackInput from './FeedbackInput';

const SHARE_ICON_SIZE = { blockSize: 32, size: 16 } as const;

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
        <Flexbox height={'100%'} style={{ overflow: 'hidden' }}>
          <Flexbox flex={1} style={{ minHeight: 0, overflow: 'hidden' }}>
            <ChatList disableActionsBar itemContent={itemContent} />
          </Flexbox>
          <Flexbox paddingBlock={'0 12px'} paddingInline={12} style={{ flexShrink: 0 }}>
            <FeedbackInput />
          </Flexbox>
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
  const { allowed: canShare, reason } = usePermission('edit_own_content');

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
        label: t('taskDetail.topicMenu.copyId', { defaultValue: 'Copy Topic ID' }),
        onClick: handleCopyTopicId,
      },
      {
        disabled: !activity?.operationId,
        icon: Copy,
        key: 'copyOperationId',
        label: t('taskDetail.topicMenu.copyOperationId', { defaultValue: 'Copy Operation ID' }),
        onClick: handleCopyOperationId,
      },
    ],
    [t, topicId, activity?.operationId, handleCopyTopicId, handleCopyOperationId],
  );

  const title = (
    <Flexbox
      horizontal
      align={'center'}
      flex={1}
      gap={8}
      style={{ maxWidth: '100%', minWidth: 0, overflow: 'hidden' }}
    >
      <TopicStatusIcon size={16} status={status} />
      {activity?.sourceTaskIdentifier && (
        <Tag
          size={'small'}
          style={{ flex: 'none' }}
          title={t('taskDetail.topicSource', {
            identifier: activity.sourceTaskIdentifier,
          })}
        >
          {activity.sourceTaskIdentifier}
        </Tag>
      )}
      <Text ellipsis style={{ flex: '0 1 auto', minWidth: 0 }} weight={500}>
        {activity?.title || t('taskDetail.topicDrawer.untitled')}
      </Text>
      {activity?.seq != null && (
        <Text fontSize={12} style={{ flex: 'none' }} type={'secondary'}>
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
      disabled={!canShare}
      icon={Share2}
      size={SHARE_ICON_SIZE}
      title={canShare ? t('share', { ns: 'common' }) : reason}
      onClick={enableTopicLinkShare || !canShare ? undefined : openShareModal}
    />
  );

  const actions =
    !topicId ? null : enableTopicLinkShare && canShare ? (
      <SharePopover topicId={topicId} onOpenModal={openShareModal}>
        {shareIcon}
      </SharePopover>
    ) : (
      shareIcon
    );

  // Freeze title/actions/body during the close animation so the panel keeps
  // its last rendered state instead of flashing to the empty/"untitled" view
  // while topicId/agentId clear.
  return (
    <FloatingPanel
      actions={<Freeze frozen={!open}>{actions}</Freeze>}
      getContainer={false}
      height={'min(640px, calc(100dvh - 16px))'}
      mask={false}
      minHeight={320}
      minWidth={360}
      open={open}
      placement={'bottomRight'}
      title={<Freeze frozen={!open}>{title}</Freeze>}
      width={640}
      styles={{
        body: { padding: 0 },
        panel: { maxHeight: 'calc(100dvh - 16px)' },
        title: {
          boxSizing: 'border-box',
          maxWidth: '100%',
          minWidth: 0,
          overflow: 'hidden',
        },
      }}
      onClose={closeTopicDrawer}
    >
      <Freeze frozen={!open}>
        {open && activeTaskId && <TopicChatDrawerBody agentId={agentId!} topicId={topicId!} />}
      </Freeze>
    </FloatingPanel>
  );
});

TopicChatDrawer.displayName = 'TopicChatDrawer';

export default TopicChatDrawer;

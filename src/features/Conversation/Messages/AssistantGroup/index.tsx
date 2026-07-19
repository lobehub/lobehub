'use client';

import type { AssistantContentBlock, EmojiReaction, UISignalCallbacksBlock } from '@lobechat/types';
import { Flexbox, Tag } from '@lobehub/ui';
import isEqual from 'fast-deep-equal';
import type { MouseEventHandler, ReactNode } from 'react';
import { memo, Suspense, useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { MESSAGE_ACTION_BAR_PORTAL_ATTRIBUTES } from '@/const/messageActionPortal';
import AgentGroupAvatar from '@/features/AgentGroupAvatar';
import { ChatItem } from '@/features/Conversation/ChatItem';
import { useOpenChatSettings } from '@/hooks/useInterceptingRoutes';
import dynamic from '@/libs/next/dynamic';
import { useAgentStore } from '@/store/agent';
import { builtinAgentSelectors } from '@/store/agent/selectors';
import { useAgentGroupStore } from '@/store/agentGroup';
import { agentGroupSelectors } from '@/store/agentGroup/selectors';
import { useGlobalStore } from '@/store/global';
import { useUserStore } from '@/store/user';
import {
  labPreferSelectors,
  userGeneralSettingsSelectors,
  userProfileSelectors,
} from '@/store/user/selectors';

import { ReactionDisplay } from '../../components/Reaction';
import { useAgentMeta } from '../../hooks';
import {
  contextSelectors,
  dataSelectors,
  messageStateSelectors,
  useConversationStore,
} from '../../store';
import { getOperationFinalRootId } from '../../store/slices/data/workSummaries';
import InterruptedHint from '../Assistant/components/InterruptedHint';
import Usage from '../components/Extras/Usage';
import MessageBranch from '../components/MessageBranch';
import {
  useSetMessageItemActionElementPortialContext,
  useSetMessageItemActionTypeContext,
} from '../Contexts/message-action-context';
import MessageWorks from '../MessageWorks';
import SignalCallbacks from '../SignalCallbacks';
import FileListViewer from '../User/components/FileListViewer';
import Group from './components/Group';
import type { WorkflowExpandLevelDefault } from './components/WorkflowCollapse';

const EditState = dynamic(() => import('./components/EditState'), {
  ssr: false,
});

const actionBarHolder = (
  <div
    {...{ [MESSAGE_ACTION_BAR_PORTAL_ATTRIBUTES.assistantGroup]: '' }}
    style={{ height: '28px' }}
  />
);

const findLatestWorkRootOperationId = (
  metadata?: { work?: { rootOperationId?: unknown } } | null,
  children?: AssistantContentBlock[],
  taskCompletions?: AssistantContentBlock[],
) => {
  const blocks = [...(children ?? []), ...(taskCompletions ?? [])];

  for (let index = blocks.length - 1; index >= 0; index -= 1) {
    const rootOperationId = getOperationFinalRootId(blocks[index]?.metadata);
    if (rootOperationId) return rootOperationId;
  }

  return getOperationFinalRootId(metadata);
};

interface GroupMessageProps {
  defaultWorkflowExpandLevel?: WorkflowExpandLevelDefault;
  disableEditing?: boolean;
  footerRender?: ReactNode;
  id: string;
  index: number;
  isLatestItem?: boolean;
}

const GroupMessage = memo<GroupMessageProps>(
  ({ defaultWorkflowExpandLevel, id, index, disableEditing, footerRender, isLatestItem }) => {
    // Get message and actionsConfig from ConversationStore
    const item = useConversationStore(dataSelectors.getDisplayMessageById(id), isEqual)!;

    const {
      agentId,
      usage,
      createdAt,
      children,
      performance,
      model,
      provider,
      branch,
      metadata,
      signalCallbacks,
      taskCompletions,
    } = item;
    const avatar = useAgentMeta(agentId);

    // Supervisor messages render the GROUP's identity (avatar + name + 主管 badge)
    // rather than the supervisor agent's own bare meta (whose title is literally
    // "Supervisor" with no avatar). The flag is a persisted snapshot on the
    // message metadata; see metadata.orchestrationRole.
    const isSupervisor = metadata?.orchestrationRole === 'supervisor' || !!metadata?.isSupervisor;
    const groupId = useConversationStore(contextSelectors.groupId);
    const groupMeta = useAgentGroupStore((s) => agentGroupSelectors.getGroupMeta(groupId ?? '')(s));
    const memberAvatars = useAgentGroupStore(
      (s) => agentGroupSelectors.getGroupMemberAvatars(groupId ?? '')(s),
      isEqual,
    );
    const { t } = useTranslation('chat');

    // Collect fileList from all children blocks
    const aggregatedFileList = useMemo(() => {
      if (!children || children.length === 0) return [];
      return children.flatMap((child: AssistantContentBlock) => child.fileList || []);
    }, [children]);
    const workRootOperationId = useMemo(
      () => findLatestWorkRootOperationId(metadata, children, taskCompletions),
      [children, metadata, taskCompletions],
    );

    const isInbox = useAgentStore(builtinAgentSelectors.isInboxAgent);
    const [toggleSystemRole] = useGlobalStore((s) => [s.toggleSystemRole]);
    const openChatSettings = useOpenChatSettings();

    // Get the latest message block from the group that doesn't contain tools
    const lastAssistantMsg = useConversationStore(
      dataSelectors.getGroupLatestMessageWithoutTools(id),
    );

    const contentId = lastAssistantMsg?.id;

    // Get editing and interrupted state from ConversationStore
    const editing = useConversationStore(messageStateSelectors.isMessageEditing(contentId || ''));
    // Check interrupted on both the group root and the active block, because
    // continuation runs attach their operations to lastBlockId (contentId),
    // not the group root.
    const groupInterrupted = useConversationStore(messageStateSelectors.isMessageInterrupted(id));
    const blockInterrupted = useConversationStore(
      messageStateSelectors.isMessageInterrupted(contentId || ''),
    );
    const interrupted = groupInterrupted || blockInterrupted;

    const isDevMode = useUserStore((s) => userGeneralSettingsSelectors.config(s).isDevMode);
    const enableProcessFold = useUserStore(labPreferSelectors.enableFoldFinishedTurn);
    const addReaction = useConversationStore((s) => s.addReaction);
    const removeReaction = useConversationStore((s) => s.removeReaction);
    const userId = useUserStore(userProfileSelectors.userId)!;
    const reactions: EmojiReaction[] = metadata?.reactions || [];

    const handleReactionClick = useCallback(
      (emoji: string) => {
        const existing = reactions.find((r) => r.emoji === emoji);
        if (existing && existing.users.includes(userId)) {
          removeReaction(id, emoji);
        } else {
          addReaction(id, emoji);
        }
      },
      [id, reactions, addReaction, removeReaction],
    );

    const isReactionActive = useCallback(
      (emoji: string) => {
        const reaction = reactions.find((r) => r.emoji === emoji);
        return !!reaction && reaction.users.includes(userId);
      },
      [reactions],
    );

    const setMessageItemActionElementPortialContext =
      useSetMessageItemActionElementPortialContext();
    const setMessageItemActionTypeContext = useSetMessageItemActionTypeContext();

    const onMouseEnter: MouseEventHandler<HTMLDivElement> = useCallback(
      (e) => {
        if (disableEditing) return;
        setMessageItemActionElementPortialContext(e.currentTarget);
        setMessageItemActionTypeContext({ id, index, type: 'assistantGroup' });
      },
      [
        disableEditing,
        id,
        index,
        setMessageItemActionElementPortialContext,
        setMessageItemActionTypeContext,
      ],
    );

    const onAvatarClick = useCallback(() => {
      if (!isInbox) {
        toggleSystemRole(true);
      } else {
        openChatSettings();
      }
    }, [isInbox]);

    return (
      <ChatItem
        showTitle
        avatar={isSupervisor ? { ...avatar, title: groupMeta.title } : avatar}
        id={id}
        placement={'left'}
        time={createdAt}
        titleAddon={isSupervisor ? <Tag>{t('supervisor.label')}</Tag> : undefined}
        actions={
          !disableEditing && (
            <>
              {isDevMode && branch && (
                <MessageBranch
                  activeBranchIndex={branch.activeBranchIndex}
                  count={branch.count}
                  messageId={id}
                />
              )}
              {actionBarHolder}
            </>
          )
        }
        afterActions={
          workRootOperationId ? <MessageWorks rootOperationId={workRootOperationId} /> : undefined
        }
        customAvatarRender={
          isSupervisor
            ? () => (
                <AgentGroupAvatar
                  avatar={groupMeta.avatar}
                  backgroundColor={groupMeta.backgroundColor}
                  memberAvatars={memberAvatars}
                />
              )
            : undefined
        }
        onAvatarClick={onAvatarClick}
        onMouseEnter={onMouseEnter}
      >
        {/*
          Wrap main chain + signal callbacks + post-task summary in a tight
          flex stack so the SignalCallbacks accordion sits visually inside
          the same "agent reply" block. The ChatItem body gap (16px) would
          otherwise stretch them apart and the natural narrative — initial
          reply → callbacks → summary — reads as three disconnected
          sections ().
        */}
        <Flexbox gap={4}>
          {children && children.length > 0 && (
            <Group
              blocks={children}
              content={lastAssistantMsg?.content}
              contentId={contentId}
              defaultWorkflowExpandLevel={defaultWorkflowExpandLevel}
              disableEditing={disableEditing}
              enableProcessFold={enableProcessFold}
              id={id}
              isLatestItem={isLatestItem}
              messageIndex={index}
            />
          )}
          {(signalCallbacks as UISignalCallbacksBlock[] | undefined)?.map((block) => (
            <SignalCallbacks block={block} key={block.sourceToolMessageId} />
          ))}
          {taskCompletions && taskCompletions.length > 0 && (
            <Group
              blocks={taskCompletions}
              contentId={taskCompletions.at(-1)?.id}
              defaultWorkflowExpandLevel={defaultWorkflowExpandLevel}
              disableEditing={disableEditing}
              id={id}
              messageIndex={index}
            />
          )}
        </Flexbox>

        {aggregatedFileList.length > 0 && (
          <div style={{ marginTop: 8 }}>
            <FileListViewer items={aggregatedFileList} />
          </div>
        )}
        {interrupted && <InterruptedHint />}
        {isDevMode && model && (
          <Usage model={model} performance={performance} provider={provider!} usage={usage} />
        )}
        {footerRender}
        {reactions.length > 0 && (
          <ReactionDisplay
            isActive={isReactionActive}
            messageId={id}
            reactions={reactions}
            onReactionClick={handleReactionClick}
          />
        )}
        <Suspense fallback={null}>
          {editing && contentId && <EditState content={lastAssistantMsg?.content} id={contentId} />}
        </Suspense>
      </ChatItem>
    );
  },
  isEqual,
);

export default GroupMessage;

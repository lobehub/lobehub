'use client';

import type { AssistantContentBlock, EmojiReaction } from '@lobechat/types';
import isEqual from 'fast-deep-equal';
import type {MouseEventHandler} from 'react';
import { memo,  Suspense, useCallback, useMemo } from 'react';

import { MESSAGE_ACTION_BAR_PORTAL_ATTRIBUTES } from '@/const/messageActionPortal';
import { ChatItem } from '@/features/Conversation/ChatItem';
import { useNewScreen } from '@/features/Conversation/Messages/components/useNewScreen';
import { useOpenChatSettings } from '@/hooks/useInterceptingRoutes';
import dynamic from '@/libs/next/dynamic';
import { useAgentStore } from '@/store/agent';
import { builtinAgentSelectors } from '@/store/agent/selectors';
import { useGlobalStore } from '@/store/global';
import { useUserStore } from '@/store/user';
import { userProfileSelectors } from '@/store/user/selectors';

import { ReactionDisplay } from '../../components/Reaction';
import { useAgentMeta } from '../../hooks';
import { dataSelectors, messageStateSelectors, useConversationStore } from '../../store';
import Usage from '../components/Extras/Usage';
import MessageBranch from '../components/MessageBranch';
import {
  useSetMessageItemActionElementPortialContext,
  useSetMessageItemActionTypeContext,
} from '../Contexts/message-action-context';
import FileListViewer from '../User/components/FileListViewer';
import Group from './components/Group';

const EditState = dynamic(() => import('./components/EditState'), {
  ssr: false,
});

const actionBarHolder = (
  <div
    {...{ [MESSAGE_ACTION_BAR_PORTAL_ATTRIBUTES.assistantGroup]: '' }}
    style={{ height: '28px' }}
  />
);
interface GroupMessageProps {
  disableEditing?: boolean;
  id: string;
  index: number;
  isLatestItem?: boolean;
}

const GroupMessage = memo<GroupMessageProps>(({ id, index, disableEditing, isLatestItem }) => {
  // Get message and actionsConfig from ConversationStore
  const item = useConversationStore(dataSelectors.getDisplayMessageById(id), isEqual)!;

  const { agentId, usage, createdAt, children, performance, model, provider, branch, metadata } =
    item;
  const avatar = useAgentMeta(agentId);

  // Collect fileList from all children blocks
  const aggregatedFileList = useMemo(() => {
    if (!children || children.length === 0) return [];
    return children.flatMap((child: AssistantContentBlock) => child.fileList || []);
  }, [children]);

  const isInbox = useAgentStore(builtinAgentSelectors.isInboxAgent);
  const [toggleSystemRole] = useGlobalStore((s) => [s.toggleSystemRole]);
  const openChatSettings = useOpenChatSettings();

  // Get the latest message block from the group that doesn't contain tools
  const lastAssistantMsg = useConversationStore(
    dataSelectors.getGroupLatestMessageWithoutTools(id),
  );

  const contentId = lastAssistantMsg?.id;

  // Get editing state from ConversationStore
  const editing = useConversationStore(messageStateSelectors.isMessageEditing(contentId || ''));
  const creating = useConversationStore(messageStateSelectors.isMessageCreating(id));
  const generating = useConversationStore(messageStateSelectors.isMessageGenerating(id));
  const { minHeight } = useNewScreen({
    creating: creating || generating,
    isLatestItem,
    messageId: id,
  });

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

  const setMessageItemActionElementPortialContext = useSetMessageItemActionElementPortialContext();
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
      avatar={avatar}
      newScreenMinHeight={minHeight}
      placement={'left'}
      time={createdAt}
      actions={
        !disableEditing && (
          <>
            {branch && (
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
      onAvatarClick={onAvatarClick}
      onMouseEnter={onMouseEnter}
    >
      {children && children.length > 0 && (
        <Group
          blocks={children}
          content={lastAssistantMsg?.content}
          contentId={contentId}
          disableEditing={disableEditing}
          id={id}
          messageIndex={index}
        />
      )}
      {aggregatedFileList.length > 0 && (
        <div style={{ marginTop: 8 }}>
          <FileListViewer items={aggregatedFileList} />
        </div>
      )}
      {model && (
        <Usage model={model} performance={performance} provider={provider!} usage={usage} />
      )}
      {reactions.length > 0 && (
        <ReactionDisplay
          isActive={isReactionActive}
          messageId={id}
          onReactionClick={handleReactionClick}
          reactions={reactions}
        />
      )}
      <Suspense fallback={null}>
        {editing && contentId && <EditState content={lastAssistantMsg?.content} id={contentId} />}
      </Suspense>
    </ChatItem>
  );
}, isEqual);

export default GroupMessage;

import { agentDisplayName } from '@lobechat/types';
import { Tag } from '@lobehub/ui/base-ui';
import isEqual from 'fast-deep-equal';
import { type MouseEventHandler } from 'react';
import { memo, useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { useActiveWorkspaceId } from '@/business/client/hooks/useActiveWorkspaceId';
import { ChatItem } from '@/features/Conversation/ChatItem';
import { useMessageCommentCount } from '@/features/TopicComment/hooks';
import MessageCommentBadge from '@/features/TopicComment/MessageCommentBadge';
import { useUserAvatar } from '@/hooks/useUserAvatar';
import { useSessionStore } from '@/store/session';
import { sessionSelectors } from '@/store/session/selectors';
import { useUserStore } from '@/store/user';
import { userProfileSelectors } from '@/store/user/selectors';

import { useDoubleClickEdit } from '../../hooks/useDoubleClickEdit';
import { dataSelectors, messageStateSelectors, useConversationStore } from '../../store';
import {
  useSetMessageItemActionElementPortialContext,
  useSetMessageItemActionTypeContext,
} from '../Contexts/message-action-context';
import Actions from './Actions';
import UserMessageContent from './components/MessageContent';
import { UserMessageExtra } from './Extra';
import { resolveSenderIdentity } from './resolveSenderIdentity';
import ScheduledRunFooter from './ScheduledRunFooter';

interface UserMessageProps {
  disableEditing?: boolean;
  id: string;
  index: number;
}

const UserMessage = memo<UserMessageProps>(({ id, disableEditing, index }) => {
  const item = useConversationStore(dataSelectors.getDisplayMessageById(id), isEqual)!;
  const { content, createdAt, error, role, extra, targetId, sender } = item;

  const { t } = useTranslation('chat');
  const selfAvatar = useUserAvatar();
  const selfTitle = useUserStore(userProfileSelectors.displayUserName);
  const activeWorkspaceId = useActiveWorkspaceId();
  const { count: commentCount, topicId: commentTopicId } = useMessageCommentCount(id);

  // In workspaces every user bubble shows its sender avatar so ownership is
  // visible even during single-user testing; personal mode keeps the legacy
  // hidden-avatar behavior. Self identity applies only to the viewer's own
  // rows — see resolveSenderIdentity.
  const showSender = Boolean(activeWorkspaceId);
  const currentUserId = useUserStore(userProfileSelectors.userId);
  const { avatar, title } = resolveSenderIdentity({
    currentUserId,
    selfAvatar,
    selfTitle,
    sender,
    unknownLabel: t('sender.unknownMember'),
  });

  // Get editing and loading state from ConversationStore
  const editing = useConversationStore(messageStateSelectors.isMessageEditing(id));

  // Get target name for DM indicator
  const userName = useUserStore(userProfileSelectors.nickName) || 'User';
  const agents = useSessionStore(sessionSelectors.currentGroupAgents);

  const dmIndicator = useMemo(() => {
    if (!targetId) return undefined;

    const targetName =
      targetId === 'user'
        ? userName
        : agentDisplayName(
            agents?.find((agent) => agent.id === targetId),
            targetId,
          );

    return <Tag>{t('dm.visibleTo', { target: targetName })}</Tag>;
  }, [targetId, userName, agents, t]);

  const onDoubleClick = useDoubleClickEdit({ disableEditing, error, id, role });

  const setMessageItemActionElementPortialContext = useSetMessageItemActionElementPortialContext();
  const setMessageItemActionTypeContext = useSetMessageItemActionTypeContext();

  const onMouseEnter: MouseEventHandler<HTMLDivElement> = useCallback(
    (e) => {
      if (disableEditing) return;
      setMessageItemActionElementPortialContext(e.currentTarget);
      setMessageItemActionTypeContext({ id, index, type: 'user' });
    },
    [
      disableEditing,
      id,
      index,
      setMessageItemActionElementPortialContext,
      setMessageItemActionTypeContext,
    ],
  );

  return (
    <ChatItem
      actions={<Actions data={item} disableEditing={disableEditing} id={id} />}
      avatar={{ avatar, title }}
      belowMessage={<ScheduledRunFooter id={id} />}
      editing={editing}
      id={id}
      message={content}
      messageExtra={<UserMessageExtra content={content} extra={extra} id={id} />}
      placement={'right'}
      showAvatar={showSender}
      showTitle={showSender}
      time={createdAt}
      titleAddon={dmIndicator}
      actionAddon={
        commentCount > 0 && commentTopicId ? (
          <MessageCommentBadge count={commentCount} messageId={id} topicId={commentTopicId} />
        ) : undefined
      }
      onDoubleClick={onDoubleClick}
      onMouseEnter={onMouseEnter}
    >
      <UserMessageContent {...item} />
    </ChatItem>
  );
}, isEqual);

export default UserMessage;

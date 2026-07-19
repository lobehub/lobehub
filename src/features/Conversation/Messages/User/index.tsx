import { Tag } from '@lobehub/ui';
import isEqual from 'fast-deep-equal';
import { type MouseEventHandler } from 'react';
import { memo, useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { useActiveWorkspaceId } from '@/business/client/hooks/useActiveWorkspaceId';
import { ChatItem } from '@/features/Conversation/ChatItem';
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

  // In workspaces every user bubble shows its sender avatar so ownership is
  // visible even during single-user testing; personal mode keeps the legacy
  // hidden-avatar behavior. Optimistic/streaming rows without a `sender`
  // fall back to the current user, which is who authored them.
  const showSender = Boolean(activeWorkspaceId);
  const senderName = sender?.fullName || sender?.username || '';
  const avatar = sender?.avatar || senderName || selfAvatar;
  const title = senderName || selfTitle;

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
        : agents?.find((agent) => agent.id === targetId)?.title || targetId;

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
      onDoubleClick={onDoubleClick}
      onMouseEnter={onMouseEnter}
    >
      <UserMessageContent {...item} />
    </ChatItem>
  );
}, isEqual);

export default UserMessage;

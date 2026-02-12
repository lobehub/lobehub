import { Tag } from '@lobehub/ui';
import isEqual from 'fast-deep-equal';
import { type MouseEventHandler } from 'react';
import { memo, useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

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

interface UserMessageProps {
  disableEditing?: boolean;
  id: string;
  index: number;
}

const UserMessage = memo<UserMessageProps>(({ id, disableEditing, index }) => {
  const item = useConversationStore(dataSelectors.getDisplayMessageById(id), isEqual)!;
  const actionsConfig = useConversationStore((s) => s.actionsBar?.user);
  const { content, createdAt, error, role, extra, targetId } = item;

  const { t } = useTranslation('chat');
  const avatar = useUserAvatar();
  const title = useUserStore(userProfileSelectors.displayUserName);

  // Get editing and loading state from ConversationStore
  const editing = useConversationStore(messageStateSelectors.isMessageEditing(id));

  // Get target name for DM indicator
  const userName = useUserStore(userProfileSelectors.nickName) || 'User';
  const agents = useSessionStore(sessionSelectors.currentGroupAgents);

  const dmIndicator = useMemo(() => {
    if (!targetId) return undefined;

    let targetName = targetId;
    if (targetId === 'user') {
      targetName = userName;
    } else {
      const targetAgent = agents?.find((agent) => agent.id === targetId);
      targetName = targetAgent?.title || targetId;
    }

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
      avatar={{ avatar, title }}
      editing={editing}
      id={id}
      message={content}
      messageExtra={<UserMessageExtra content={content} extra={extra} id={id} />}
      placement={'right'}
      showAvatar={false}
      showTitle={false}
      time={createdAt}
      titleAddon={dmIndicator}
      actions={
        <Actions
          actionsConfig={actionsConfig}
          data={item}
          disableEditing={disableEditing}
          id={id}
          index={index}
        />
      }
      onDoubleClick={onDoubleClick}
      onMouseEnter={onMouseEnter}
    >
      <UserMessageContent {...item} />
    </ChatItem>
  );
}, isEqual);

export default UserMessage;

import { agentDisplayName } from '@lobechat/types';
import { Tag } from '@lobehub/ui/base-ui';
import isEqual from 'fast-deep-equal';
import { type MouseEventHandler } from 'react';
import { memo, useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { useActiveWorkspaceId } from '@/business/client/hooks/useActiveWorkspaceId';
import { ChatItem } from '@/features/Conversation/ChatItem';
import { getScmEventSource } from '@/features/Conversation/Markdown/plugins/ScmEvent/parseScmEvent';
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
import AgentSenderSourceLink from './components/AgentSenderSourceLink';
import UserMessageContent from './components/MessageContent';
import { ScmEventAvatar, ScmEventSenderTitle } from './components/ScmEventSender';
import { UserMessageExtra } from './Extra';
import { getBotSender, resolveSenderIdentity } from './resolveSenderIdentity';
import ScheduledRunFooter from './ScheduledRunFooter';

interface UserMessageProps {
  disableEditing?: boolean;
  id: string;
  index: number;
}

const UserMessage = memo<UserMessageProps>(({ id, disableEditing, index }) => {
  const item = useConversationStore(dataSelectors.getDisplayMessageById(id), isEqual)!;
  const { content, createdAt, error, role, extra, targetId, sender, metadata } = item;
  const botSender = getBotSender(item);
  // An agent → agent turn (a sibling agent's `lh agent run`): the row belongs to
  // the receiving agent's topic, so the sending agent — not the human owner —
  // is who the bubble must be attributed to.
  const agentSender = metadata?.agentSender;
  // A wake-up message from the SCM integration is authored by the pull
  // request, so GitHub takes the sender slot instead of the card's header.
  const scmSource = useMemo(() => getScmEventSource(content), [content]);

  const { t } = useTranslation('chat');
  const selfAvatar = useUserAvatar();
  const selfTitle = useUserStore(userProfileSelectors.displayUserName);
  const activeWorkspaceId = useActiveWorkspaceId();
  const { count: commentCount, topicId: commentTopicId } = useMessageCommentCount(id);

  // In workspaces every user bubble shows its sender avatar so ownership is
  // visible even during single-user testing; personal mode keeps the legacy
  // hidden-avatar behavior. Self identity applies only to the viewer's own
  // rows — see resolveSenderIdentity.
  // A bot-channel row is authored by someone else even in personal mode, so
  // its sender is always shown. Same for an agent → agent turn.
  const showSender = Boolean(activeWorkspaceId) || !!botSender || !!scmSource || !!agentSender;
  const currentUserId = useUserStore(userProfileSelectors.userId);
  const { avatar, title } = resolveSenderIdentity({
    agentSender,
    botSender,
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
      customAvatarRender={scmSource ? () => <ScmEventAvatar /> : undefined}
      editing={editing}
      id={id}
      message={content}
      messageExtra={<UserMessageExtra extra={extra} id={id} />}
      placement={'right'}
      showAvatar={showSender}
      showTitle={showSender && !scmSource}
      time={createdAt}
      titleAddon={dmIndicator}
      actionAddon={
        commentCount > 0 && commentTopicId ? (
          <MessageCommentBadge count={commentCount} messageId={id} topicId={commentTopicId} />
        ) : undefined
      }
      headerAddon={
        scmSource || metadata?.steer || agentSender?.topicId ? (
          <>
            {scmSource && <ScmEventSenderTitle source={scmSource} />}
            {metadata?.steer && <Tag>{t('steer.tag')}</Tag>}
            {/* Sits in the header rather than `titleAddon` so the reversed
                (right-aligned) row reads name → source link → avatar, keeping
                the author first and its origin a trailing affordance. */}
            {agentSender?.topicId && (
              <AgentSenderSourceLink
                agentId={agentSender.agentId}
                topicId={agentSender.topicId}
                topicTitle={agentSender.topicTitle}
              />
            )}
          </>
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

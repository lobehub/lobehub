import { agentDisplayName } from '@lobechat/types';
import { Flexbox, Tag } from '@lobehub/ui';
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
import McpAppSourceFooter from './McpAppSourceFooter';
import { getAgentSender, getBotSender, resolveSenderIdentity } from './resolveSenderIdentity';
import ScheduledRunFooter from './ScheduledRunFooter';
import {
  SubAgentSenderTags,
  SubAgentThreadLink,
  useSubAgentSenderIdentity,
} from './SubAgentSender';

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
  const agentSender = getAgentSender(item);
  // A wake-up message from the SCM integration is authored by the pull
  // request, so GitHub takes the sender slot instead of the card's header.
  const scmSource = useMemo(() => getScmEventSource(content), [content]);
  // A background sub-agent reporting back speaks in a user turn of its own.
  const subAgentCallback = metadata?.subAgentCallback;
  const subAgentSender = useSubAgentSenderIdentity(subAgentCallback);
  const editingDisabled = disableEditing || !!subAgentCallback;

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
  // its sender is always shown. Same for an agent → agent turn and a
  // background sub-agent's report.
  const showSender =
    Boolean(activeWorkspaceId) || !!botSender || !!scmSource || !!agentSender || !!subAgentSender;
  const currentUserId = useUserStore(userProfileSelectors.userId);
  const { avatar, title } = resolveSenderIdentity({
    currentUserId,
    message: item,
    selfAvatar,
    selfTitle,
    sender,
    subAgentSender,
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

  const onDoubleClick = useDoubleClickEdit({ disableEditing: editingDisabled, error, id, role });

  const setMessageItemActionElementPortialContext = useSetMessageItemActionElementPortialContext();
  const setMessageItemActionTypeContext = useSetMessageItemActionTypeContext();

  const onMouseEnter: MouseEventHandler<HTMLDivElement> = useCallback(
    (e) => {
      if (editingDisabled) return;
      setMessageItemActionElementPortialContext(e.currentTarget);
      setMessageItemActionTypeContext({ id, index, type: 'user' });
    },
    [
      editingDisabled,
      id,
      index,
      setMessageItemActionElementPortialContext,
      setMessageItemActionTypeContext,
    ],
  );

  return (
    <ChatItem
      actions={<Actions data={item} disableEditing={editingDisabled} id={id} />}
      avatar={{ avatar, title }}
      customAvatarRender={scmSource ? () => <ScmEventAvatar /> : undefined}
      editing={editing}
      headerAddon={scmSource ? <ScmEventSenderTitle source={scmSource} /> : undefined}
      id={id}
      message={content}
      messageExtra={<UserMessageExtra extra={extra} id={id} />}
      placement={'right'}
      showAvatar={showSender}
      showTitle={showSender && !scmSource}
      time={createdAt}
      actionAddon={
        commentCount > 0 && commentTopicId ? (
          <MessageCommentBadge count={commentCount} messageId={id} topicId={commentTopicId} />
        ) : undefined
      }
      belowMessage={
        <>
          {subAgentCallback && <SubAgentThreadLink callback={subAgentCallback} />}
          {metadata?.mcpAppSource && <McpAppSourceFooter source={metadata.mcpAppSource} />}
          <ScheduledRunFooter id={id} />
        </>
      }
      titleAddon={
        subAgentCallback ? (
          <SubAgentSenderTags callback={subAgentCallback} />
        ) : dmIndicator || agentSender?.topicId ? (
          <>
            {dmIndicator}
            {agentSender?.topicId && (
              <AgentSenderSourceLink
                chatGroupId={agentSender.chatGroupId}
                threadId={agentSender.threadId}
                topicAgentId={agentSender.topicAgentId ?? agentSender.agentId}
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
      {metadata?.steer ? (
        // The steer tag labels the instruction itself, so it sits inside the
        // bubble rather than in the sender header.
        <Flexbox align={'flex-start'} gap={4}>
          <Tag>{t('steer.tag')}</Tag>
          <UserMessageContent {...item} />
        </Flexbox>
      ) : (
        <UserMessageContent {...item} />
      )}
    </ChatItem>
  );
}, isEqual);

export default UserMessage;

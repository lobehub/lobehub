'use client';

import { Tag } from '@lobehub/ui';
import isEqual from 'fast-deep-equal';
import { type MouseEventHandler, memo, useCallback } from 'react';
import { useTranslation } from 'react-i18next';

import { MESSAGE_ACTION_BAR_PORTAL_ATTRIBUTES } from '@/const/messageActionPortal';
import AgentGroupAvatar from '@/features/AgentGroupAvatar';
import { ChatItem } from '@/features/Conversation/ChatItem';
import { useNewScreen } from '@/features/Conversation/Messages/components/useNewScreen';
import { useAgentGroupStore } from '@/store/agentGroup';
import { agentGroupSelectors } from '@/store/agentGroup/selectors';

import { useAgentMeta } from '../../hooks';
import { dataSelectors, messageStateSelectors, useConversationStore } from '../../store';
import {
  useSetMessageItemActionElementPortialContext,
  useSetMessageItemActionTypeContext,
} from '../Contexts/message-action-context';
import Usage from '../components/Extras/Usage';
import MessageBranch from '../components/MessageBranch';
import Group from './components/Group';

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
  const { t } = useTranslation('chat');

  // Get message and actionsConfig from ConversationStore
  const item = useConversationStore(dataSelectors.getDisplayMessageById(id), isEqual)!;

  const { agentId, usage, createdAt, children, performance, model, provider, branch } = item;
  const avatar = useAgentMeta(agentId);

  // Get group member avatars for GroupAvatar
  const memberAvatars = useAgentGroupStore(
    (s) => agentGroupSelectors.currentGroupMemberAvatars(s),
    isEqual,
  );

  // Get group meta for title
  const groupMeta = useAgentGroupStore(agentGroupSelectors.currentGroupMeta);

  // Get editing state from ConversationStore
  const creating = useConversationStore(messageStateSelectors.isMessageCreating(id));
  const generating = useConversationStore(messageStateSelectors.isMessageGenerating(id));
  const { minHeight } = useNewScreen({
    creating: creating || generating,
    isLatestItem,
    messageId: id,
  });

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

  return (
    <ChatItem
      actions={
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
      }
      avatar={{ ...avatar, title: groupMeta.title }}
      customAvatarRender={() => (
        <AgentGroupAvatar
          avatar={groupMeta.avatar}
          backgroundColor={groupMeta.backgroundColor}
          memberAvatars={memberAvatars}
        />
      )}
      newScreenMinHeight={minHeight}
      onMouseEnter={onMouseEnter}
      placement={'left'}
      showTitle
      time={createdAt}
      titleAddon={<Tag>{t('supervisor.label')}</Tag>}
    >
      {children && children.length > 0 && (
        <Group
          blocks={children}
          content={item.content}
          disableEditing={disableEditing}
          id={id}
          messageIndex={index}
        />
      )}
      {model && (
        <Usage model={model} performance={performance} provider={provider!} usage={usage} />
      )}
    </ChatItem>
  );
}, isEqual);

export default GroupMessage;

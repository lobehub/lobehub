'use client';

import { GROUP_CHAT_URL } from '@lobechat/const';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import AgentGroupAvatar from '@/features/AgentGroupAvatar';
import { useGroupDropdownMenu } from '@/features/HomeSidebar/Body/Agent/List/AgentGroupItem/useDropdownMenu';

import ConversationRow from './ConversationRow';
import { type Conversation } from './conversations';
import { AVATAR_SIZE } from './style';

interface GroupConversationProps {
  active: boolean;
  conversation: Conversation;
}

const GroupConversation = memo<GroupConversationProps>(({ active, conversation }) => {
  const { item, preview, activeAt } = conversation;
  const { id, avatar, backgroundColor, description, pinned, userId } = item;
  const { t } = useTranslation('chat');
  const title = item.title || t('untitledAgent');
  const customAvatar = typeof avatar === 'string' ? avatar : undefined;
  const memberAvatars = Array.isArray(avatar) ? avatar : [];

  const contextMenuItems = useGroupDropdownMenu({
    anchor: null,
    avatar: customAvatar,
    backgroundColor: backgroundColor || undefined,
    description,
    id,
    memberAvatars,
    pinned: pinned ?? false,
    title,
    userId,
  });

  return (
    <ConversationRow
      active={active}
      activeAt={activeAt}
      contextMenuItems={contextMenuItems}
      preview={preview}
      title={title}
      unread={item.unreadCount}
      url={GROUP_CHAT_URL(id)}
      avatar={
        <AgentGroupAvatar
          avatar={customAvatar}
          backgroundColor={backgroundColor || undefined}
          memberAvatars={memberAvatars}
          size={AVATAR_SIZE}
        />
      }
    />
  );
});

GroupConversation.displayName = 'GroupConversation';

export default GroupConversation;

'use client';

import { DEFAULT_AVATAR } from '@lobechat/const';
import { agentDisplayName } from '@lobechat/types';
import { memo, useCallback } from 'react';
import { useTranslation } from 'react-i18next';

import Avatar from '@/components/Avatar';
import { useAgentDropdownMenu } from '@/features/HomeSidebar/Body/Agent/List/AgentItem/useDropdownMenu';
import { usePreservedAgentUrl } from '@/features/HomeSidebar/Body/Agent/List/usePreservedAgentUrl';
import { useAgentModal } from '@/features/HomeSidebar/Body/Agent/ModalProvider';
import { usePrefetchAgent } from '@/hooks/usePrefetchAgent';
import { useChatStore } from '@/store/chat';
import { operationSelectors } from '@/store/chat/selectors';

import ConversationRow from './ConversationRow';
import { type Conversation } from './conversations';
import { AVATAR_SIZE } from './style';

interface AgentConversationProps {
  active: boolean;
  conversation: Conversation;
}

const AgentConversation = memo<AgentConversationProps>(({ active, conversation }) => {
  const { item, preview, activeAt } = conversation;
  const { id, avatar, backgroundColor, pinned, slug, userId, visibility } = item;
  const { t } = useTranslation('chat');
  const { openCreateGroupModal } = useAgentModal();
  const prefetchAgent = usePrefetchAgent();
  const running = useChatStore(operationSelectors.isAgentVisiblyRunning(id));
  const url = usePreservedAgentUrl(id);
  const title = agentDisplayName(item, t('untitledAgent'));
  const avatarSrc = typeof avatar === 'string' ? avatar : undefined;

  const handleOpenCreateGroupModal = useCallback(
    () => openCreateGroupModal(id, visibility),
    [id, openCreateGroupModal, visibility],
  );

  const contextMenuItems = useAgentDropdownMenu({
    avatar: avatarSrc,
    backgroundColor: backgroundColor || undefined,
    group: undefined,
    id,
    name: item.name,
    openCreateGroupModal: handleOpenCreateGroupModal,
    pinned: pinned ?? false,
    slug,
    title,
    userId,
    visibility,
  });

  return (
    <ConversationRow
      active={active}
      activeAt={activeAt}
      contextMenuItems={contextMenuItems}
      preview={preview}
      running={running}
      title={title}
      unread={item.unreadCount}
      url={url}
      avatar={
        <Avatar
          emojiScaleWithBackground
          avatar={avatarSrc || DEFAULT_AVATAR}
          background={backgroundColor || undefined}
          name={title}
          shape={'square'}
          size={AVATAR_SIZE}
        />
      }
      onMouseEnter={() => prefetchAgent(id)}
    />
  );
});

AgentConversation.displayName = 'AgentConversation';

export default AgentConversation;

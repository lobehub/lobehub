'use client';

import { agentDisplayName } from '@lobechat/types';
import { memo, useCallback } from 'react';
import { useTranslation } from 'react-i18next';

import AgentAvatar from '@/components/AgentAvatar';
import { useAgentDropdownMenu } from '@/features/HomeSidebar/Body/Agent/List/AgentItem/useDropdownMenu';
import { usePreservedAgentUrl } from '@/features/HomeSidebar/Body/Agent/List/usePreservedAgentUrl';
import { useAgentModal } from '@/features/HomeSidebar/Body/Agent/ModalProvider';
import { usePrefetchAgent } from '@/hooks/usePrefetchAgent';
import { useChatStore } from '@/store/chat';
import { operationSelectors } from '@/store/chat/selectors';

import ConversationRow from './ConversationRow';
import { type Conversation } from './conversations';
import { AVATAR_SIZE } from './style';
import { useAgentConversationLink } from './useAgentConversationLink';

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
  const agentUrl = usePreservedAgentUrl(id);
  const { onClick, url } = useAgentConversationLink(id, agentUrl);
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
    // The Messages list ignores the sidebar visibility preference.
    sidebarVisibilityEnabled: false,
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
      pinned={!!pinned}
      preview={preview}
      running={running}
      title={title}
      unread={item.unreadCount}
      url={url}
      avatar={
        // Same avatar the agent has everywhere else, including its direct Channel: its own
        // image or emoji, else the character generated from its id.
        <AgentAvatar
          agentId={id}
          avatar={avatarSrc}
          background={backgroundColor || undefined}
          name={title}
          size={AVATAR_SIZE}
        />
      }
      onClick={onClick}
      onMouseEnter={() => prefetchAgent(id)}
    />
  );
});

AgentConversation.displayName = 'AgentConversation';

export default AgentConversation;

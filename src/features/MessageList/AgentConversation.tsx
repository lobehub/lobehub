'use client';

import { agentDisplayName } from '@lobechat/types';
import { type DropdownItem } from '@lobehub/ui';
import { memo, useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import AgentAvatar from '@/components/AgentAvatar';
import { useChannelMenu } from '@/features/Channels/useChannelMenu';
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

/** The direct Channel's own conversation actions, next to the Agent's own menu. */
const CONVERSATION_ACTION_KEYS = new Set(['archive', 'unarchive', 'delete']);

/**
 * A row that opens a direct Channel *is* that conversation, so the Channel's archive and
 * trash actions belong on the row: without them, archiving or trashing the conversation
 * means opening it first, and the Agent's Delete removes the Agent instead. Keys are
 * prefixed so they cannot collide with the Agent's own `delete`.
 */
const conversationActions = (menu: DropdownItem[]): DropdownItem[] =>
  menu.flatMap((item) => {
    if (!item || !('key' in item)) return [];
    const key = String(item.key);
    if (!CONVERSATION_ACTION_KEYS.has(key)) return [];
    return [{ ...item, key: `channel-${key}` } as DropdownItem];
  });

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
  const channelMenu = useChannelMenu();
  const directChannel = conversation.channel;
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

  const menuItems = useMemo(
    () => () => {
      const agentItems = contextMenuItems();
      if (!directChannel) return agentItems;
      const items = conversationActions(channelMenu(directChannel));
      if (items.length === 0) return agentItems;
      return [...agentItems, { type: 'divider' as const }, ...items];
    },
    [channelMenu, contextMenuItems, directChannel],
  );

  return (
    <ConversationRow
      closeOnReselect
      active={active}
      activeAt={activeAt}
      contextMenuItems={menuItems}
      preview={preview}
      running={running}
      title={title}
      unread={conversation.unread ?? item.unreadCount}
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

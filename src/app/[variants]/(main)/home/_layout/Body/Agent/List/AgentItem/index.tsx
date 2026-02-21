import { SESSION_CHAT_URL } from '@lobechat/const';
import { type SidebarAgentItem } from '@lobechat/types';
import { ActionIcon, Icon } from '@lobehub/ui';
import { cssVar } from 'antd-style';
import { Loader2, PinIcon } from 'lucide-react';
import { type CSSProperties, type DragEvent } from 'react';
import { memo, useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';

import NavItem from '@/features/NavPanel/components/NavItem';
import { useChatStore } from '@/store/chat';
import { operationSelectors } from '@/store/chat/selectors';
import { useGlobalStore } from '@/store/global';
import { useHomeStore } from '@/store/home';

import { useAgentModal } from '../../ModalProvider';
import Actions from '../Item/Actions';
import Avatar from './Avatar';
import { useAgentDropdownMenu } from './useDropdownMenu';

interface AgentItemProps {
  className?: string;
  item: SidebarAgentItem;
  style?: CSSProperties;
}

const AgentItem = memo<AgentItemProps>(({ item, style, className }) => {
  const { id, avatar, title, pinned } = item;
  const { t } = useTranslation('chat');
  const { openCreateGroupModal } = useAgentModal();
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const openAgentInNewWindow = useGlobalStore((s) => s.openAgentInNewWindow);

  const isUpdating = useHomeStore((s) => s.agentUpdatingId === id);

  // Separate loading state from chat store - only show loading for this specific agent
  const isLoading = useChatStore(operationSelectors.isAgentRunning(id));

  // Get display title with fallback
  const displayTitle = title || t('untitledAgent');

  // Get URL for this agent
  const agentUrl = SESSION_CHAT_URL(id, false);

  // Memoize event handlers
  const handleDoubleClick = useCallback(() => {
    openAgentInNewWindow(id);
  }, [id, openAgentInNewWindow]);

  const handleDragStart = useCallback(
    (e: DragEvent) => {
      e.dataTransfer.setData('text/plain', id);
    },
    [id],
  );

  const handleDragEnd = useCallback(
    (e: DragEvent) => {
      if (e.dataTransfer.dropEffect === 'none') {
        openAgentInNewWindow(id);
      }
    },
    [id, openAgentInNewWindow],
  );

  const handleOpenCreateGroupModal = useCallback(() => {
    openCreateGroupModal(id);
  }, [id, openCreateGroupModal]);

  // Memoize pin icon
  const pinIcon = useMemo(
    () =>
      pinned ? (
        <ActionIcon icon={PinIcon} size={12} style={{ opacity: 0.5, pointerEvents: 'none' }} />
      ) : undefined,
    [pinned],
  );

  // Memoize avatar icon (show loader when updating)
  const avatarIcon = useMemo(() => {
    if (isUpdating) {
      return <Icon spin color={cssVar.colorTextDescription} icon={Loader2} size={18} />;
    }

    return <Avatar avatar={typeof avatar === 'string' ? avatar : undefined} />;
  }, [isUpdating, avatar]);

  const dropdownMenu = useAgentDropdownMenu({
    anchor,
    avatar: typeof avatar === 'string' ? avatar : undefined,
    group: undefined, // TODO: pass group from parent if needed
    id,
    openCreateGroupModal: handleOpenCreateGroupModal,
    pinned: pinned ?? false,
    title: displayTitle,
  });

  return (
    <Link aria-label={displayTitle} ref={setAnchor} to={agentUrl}>
      <NavItem
        actions={<Actions dropdownMenu={dropdownMenu} />}
        className={className}
        contextMenuItems={dropdownMenu}
        disabled={isUpdating}
        draggable={!isUpdating}
        extra={pinIcon}
        icon={avatarIcon}
        key={id}
        loading={isLoading}
        style={style}
        title={displayTitle}
        onDoubleClick={handleDoubleClick}
        onDragEnd={handleDragEnd}
        onDragStart={handleDragStart}
      />
    </Link>
  );
});

export default AgentItem;

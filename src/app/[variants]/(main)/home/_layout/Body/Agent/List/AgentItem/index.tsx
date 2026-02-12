import { SESSION_CHAT_URL } from '@lobechat/const';
import { type SidebarAgentItem } from '@lobechat/types';
import { ActionIcon, Icon } from '@lobehub/ui';
import { cssVar } from 'antd-style';
import { Loader2, PinIcon } from 'lucide-react';
import { type CSSProperties, type DragEvent } from 'react';
import { memo, useCallback, useMemo } from 'react';
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
import Editing from './Editing';
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
  const openAgentInNewWindow = useGlobalStore((s) => s.openAgentInNewWindow);

  // Get UI state from homeStore (editing, updating)
  const [editing, isUpdating] = useHomeStore((s) => [
    s.agentRenamingId === id,
    s.agentUpdatingId === id,
  ]);

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

  const toggleEditing = useCallback(
    (visible?: boolean) => {
      useHomeStore.getState().setAgentRenamingId(visible ? id : null);
    },
    [id],
  );

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
    group: undefined, // TODO: pass group from parent if needed
    id,
    openCreateGroupModal: handleOpenCreateGroupModal,
    pinned: pinned ?? false,
    toggleEditing,
  });

  return (
    <>
      <Link aria-label={displayTitle} to={agentUrl}>
        <NavItem
          actions={<Actions dropdownMenu={dropdownMenu} />}
          className={className}
          contextMenuItems={dropdownMenu}
          disabled={editing || isUpdating}
          draggable={!editing && !isUpdating}
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

      <Editing
        avatar={typeof avatar === 'string' ? avatar : undefined}
        id={id}
        title={displayTitle}
        toggleEditing={toggleEditing}
      />
    </>
  );
});

export default AgentItem;

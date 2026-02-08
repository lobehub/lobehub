import { GROUP_CHAT_URL } from '@lobechat/const';
import type { SidebarAgentItem } from '@lobechat/types';
import { ActionIcon, Icon } from '@lobehub/ui';
import { cssVar } from 'antd-style';
import { Loader2, PinIcon } from 'lucide-react';
import { type CSSProperties, type DragEvent, memo, useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';

import AgentGroupAvatar from '@/features/AgentGroupAvatar';
import NavItem from '@/features/NavPanel/components/NavItem';
import { useGlobalStore } from '@/store/global';
import { useHomeStore } from '@/store/home';

import Actions from '../Item/Actions';
import Editing from './Editing';
import { useGroupDropdownMenu } from './useDropdownMenu';

interface GroupItemProps {
  className?: string;
  item: SidebarAgentItem;
  style?: CSSProperties;
}

const GroupItem = memo<GroupItemProps>(({ item, style, className }) => {
  const { id, avatar, backgroundColor, title, pinned } = item;
  const { t } = useTranslation('chat');

  const openAgentInNewWindow = useGlobalStore((s) => s.openAgentInNewWindow);

  // Get UI state from homeStore (editing, updating)
  const [editing, isUpdating] = useHomeStore((s) => [
    s.groupRenamingId === id,
    s.groupUpdatingId === id,
  ]);

  // Get display title with fallback
  const displayTitle = title || t('untitledAgent');

  // Get URL for this group
  const groupUrl = GROUP_CHAT_URL(id);

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

  const toggleEditing = useCallback(
    (visible?: boolean) => {
      useHomeStore.getState().setGroupRenamingId(visible ? id : null);
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
      return <Icon color={cssVar.colorTextDescription} icon={Loader2} size={18} spin />;
    }

    // If avatar is a string, it's a custom group avatar
    const customAvatar = typeof avatar === 'string' ? avatar : undefined;
    // If avatar is an array, it's member avatars for composition
    const memberAvatars = Array.isArray(avatar) ? avatar : [];

    return (
      <AgentGroupAvatar
        avatar={customAvatar}
        backgroundColor={backgroundColor || undefined}
        memberAvatars={memberAvatars}
        size={22}
      />
    );
  }, [isUpdating, avatar, backgroundColor]);

  const dropdownMenu = useGroupDropdownMenu({
    id,
    pinned: pinned ?? false,
    toggleEditing,
  });

  return (
    <>
      <Link aria-label={id} to={groupUrl}>
        <NavItem
          actions={<Actions dropdownMenu={dropdownMenu} />}
          className={className}
          contextMenuItems={dropdownMenu}
          disabled={editing || isUpdating}
          draggable={!editing && !isUpdating}
          extra={pinIcon}
          icon={avatarIcon}
          key={id}
          onDoubleClick={handleDoubleClick}
          onDragEnd={handleDragEnd}
          onDragStart={handleDragStart}
          style={style}
          title={displayTitle}
        />
      </Link>
      <Editing id={id} title={displayTitle} toggleEditing={toggleEditing} />
    </>
  );
});

export default GroupItem;

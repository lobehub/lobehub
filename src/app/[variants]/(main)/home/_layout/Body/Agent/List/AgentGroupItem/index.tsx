import { GROUP_CHAT_URL } from '@lobechat/const';
import type { SidebarAgentItem } from '@lobechat/types';
import { ActionIcon, Icon } from '@lobehub/ui';
import { cssVar } from 'antd-style';
import { Loader2, PinIcon } from 'lucide-react';
import { type CSSProperties, type DragEvent, memo, useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';

import GroupAvatar from '@/features/GroupAvatar';
import NavItem from '@/features/NavPanel/components/NavItem';
import { useGlobalStore } from '@/store/global';
import { useHomeStore } from '@/store/home';

import Actions from '../Item/Actions';
import { useDropdownMenu } from '../Item/useDropdownMenu';
import Editing from './Editing';

interface GroupItemProps {
  className?: string;
  item: SidebarAgentItem;
  style?: CSSProperties;
}

const GroupItem = memo<GroupItemProps>(({ item, style, className }) => {
  const { id, avatar, title, pinned } = item;
  const { t } = useTranslation('chat');

  const openAgentInNewWindow = useGlobalStore((s) => s.openAgentInNewWindow);

  // Get UI state from homeStore (editing, updating)
  const [editing, isUpdating] = useHomeStore((s) => [
    s.agentRenamingId === id,
    s.agentUpdatingId === id,
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
      return <Icon color={cssVar.colorTextDescription} icon={Loader2} size={18} spin />;
    }
    return <GroupAvatar avatars={(avatar as any) || []} size={22} />;
  }, [isUpdating, avatar]);

  const dropdownMenu = useDropdownMenu({
    group: undefined,
    id,
    openCreateGroupModal: () => {}, // Groups don't need this
    parentType: 'group',
    pinned: pinned ?? false,
    sessionType: 'group',
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

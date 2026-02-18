import { GROUP_CHAT_URL } from '@lobechat/const';
import { type SidebarAgentItem } from '@lobechat/types';
import { ActionIcon, Icon } from '@lobehub/ui';
import { cssVar } from 'antd-style';
import { Loader2, PinIcon } from 'lucide-react';
import { type CSSProperties, type DragEvent } from 'react';
import { memo, useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';

import AgentGroupAvatar from '@/features/AgentGroupAvatar';
import NavItem from '@/features/NavPanel/components/NavItem';
import { useGlobalStore } from '@/store/global';
import { useHomeStore } from '@/store/home';

import Actions from '../Item/Actions';
import { useGroupDropdownMenu } from './useDropdownMenu';

interface GroupItemProps {
  className?: string;
  item: SidebarAgentItem;
  style?: CSSProperties;
}

const GroupItem = memo<GroupItemProps>(({ item, style, className }) => {
  const { id, avatar, backgroundColor, title, pinned } = item;
  const { t } = useTranslation('chat');
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);

  const openAgentInNewWindow = useGlobalStore((s) => s.openAgentInNewWindow);

  const isUpdating = useHomeStore((s) => s.groupUpdatingId === id);

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

  const customAvatar = typeof avatar === 'string' ? avatar : undefined;
  const memberAvatars = Array.isArray(avatar) ? avatar : [];

  const dropdownMenu = useGroupDropdownMenu({
    anchor,
    avatar: customAvatar,
    id,
    memberAvatars,
    pinned: pinned ?? false,
    title: displayTitle,
  });

  return (
    <Link aria-label={id} ref={setAnchor} to={groupUrl}>
      <NavItem
        actions={<Actions dropdownMenu={dropdownMenu} />}
        className={className}
        contextMenuItems={dropdownMenu}
        disabled={isUpdating}
        draggable={!isUpdating}
        extra={pinIcon}
        icon={avatarIcon}
        key={id}
        style={style}
        title={displayTitle}
        onDoubleClick={handleDoubleClick}
        onDragEnd={handleDragEnd}
        onDragStart={handleDragStart}
      />
    </Link>
  );
});

export default GroupItem;

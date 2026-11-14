'use client';

import type { SidebarGroup } from '@lobechat/types';
import { ActionIcon, DropdownMenu, Flexbox, Icon, Tooltip } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import { MoreHorizontalIcon, PinIcon, UsersIcon } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { useFolderPinMenuItems } from '@/features/HomeSidebar/Body/Agent/useFolderPinMenuItems';

/**
 * Pin state and pin menu of a public workspace folder, shown on its section
 * header. Public folders are only in the sidebar when pinned, so this page is
 * where a member pins one for themselves and an owner/admin pins one for the
 * team.
 */
const FolderPinActions = memo<{ folder: SidebarGroup }>(({ folder }) => {
  const { t } = useTranslation('common');
  const { isMyPinned, isTeamPinned, menuItems } = useFolderPinMenuItems({
    id: folder.id,
    pinned: folder.pinned,
    visibility: folder.visibility,
  });

  if (menuItems.length === 0 && !isTeamPinned && !isMyPinned) return null;

  return (
    <Flexbox
      horizontal
      align={'center'}
      gap={4}
      style={{ marginInlineStart: 'auto' }}
      onClick={(e) => e.stopPropagation()}
    >
      {isTeamPinned && (
        <Tooltip title={t('navPanel.teamPinnedHint')}>
          <Icon color={cssVar.colorTextTertiary} icon={UsersIcon} size={14} />
        </Tooltip>
      )}
      {isMyPinned && (
        <Tooltip title={t('navPanel.myPinned')}>
          <Icon color={cssVar.colorTextTertiary} icon={PinIcon} size={14} />
        </Tooltip>
      )}
      {menuItems.length > 0 && (
        <DropdownMenu items={menuItems}>
          <ActionIcon icon={MoreHorizontalIcon} size={'small'} />
        </DropdownMenu>
      )}
    </Flexbox>
  );
});

FolderPinActions.displayName = 'FolderPinActions';

export default FolderPinActions;

'use client';

import { type DropdownItem, DropdownMenu, Icon, type MenuInfo } from '@lobehub/ui';
import { ActionIcon } from '@lobehub/ui/base-ui';
import { cssVar } from 'antd-style';
import { CheckIcon, LockIcon, UsersIcon } from 'lucide-react';
import { memo, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useActiveWorkspaceId } from '@/business/client/hooks/useActiveWorkspaceId';
import { DESKTOP_HEADER_ICON_SMALL_SIZE } from '@/const/layoutTokens';
import { useResourceManagerStore } from '@/features/ResourceManager/store';
import type { ResourceListVisibilityFilter } from '@/features/ResourceManager/store/initialState';

const OPTIONS: Array<{
  icon: typeof LockIcon;
  key: ResourceListVisibilityFilter;
  labelKey: string;
}> = [
  {
    icon: LockIcon,
    key: 'private',
    labelKey: 'resources.visibility.private',
  },
  {
    icon: UsersIcon,
    key: 'workspace',
    labelKey: 'resources.visibility.workspace',
  },
];

/**
 * Sidebar-header scope chip, mirroring the task list's visibility filter:
 * collapsed it is a single icon for the active scope (🔒 private / 👥
 * workspace); the dropdown lists both scopes with a check on the current one.
 *
 * Rendered only in team-workspace mode — personal mode has no notion of
 * visibility, so the toggle is meaningless there and is deliberately hidden.
 * Selecting a mode drives both the list filter (via `listVisibility`) and the
 * upload default (via `useTopLevelFileUpload`), so a single click switches
 * both what the user sees and where the next upload lands.
 */
const ResourceModeToggle = memo(() => {
  const { t } = useTranslation('chat');
  const activeWorkspaceId = useActiveWorkspaceId();
  const [listVisibility, setListVisibility, hydrateListVisibility] = useResourceManagerStore(
    (s) => [s.listVisibility, s.setListVisibility, s.hydrateListVisibility],
  );
  const [open, setOpen] = useState(false);

  const workspaceId = activeWorkspaceId ?? undefined;

  // Rehydrate from localStorage whenever the active workspace changes, so
  // switching workspaces (or coming back after a reload) restores the mode
  // this user last used in *this* workspace. Personal mode falls through to
  // the initialState default.
  useEffect(() => {
    hydrateListVisibility(workspaceId);
  }, [workspaceId, hydrateListVisibility]);

  const menuItems = useMemo<DropdownItem[]>(
    () =>
      OPTIONS.map((option) => {
        const OptionIcon = option.icon;
        return {
          extra:
            option.key === listVisibility ? (
              <Icon color={cssVar.colorTextSecondary} icon={CheckIcon} size={14} />
            ) : undefined,
          icon: <Icon color={cssVar.colorTextSecondary} icon={OptionIcon} size={16} />,
          key: option.key,
          label: t(option.labelKey as never),
          onClick: ({ domEvent }: MenuInfo) => {
            domEvent.stopPropagation();
            if (!workspaceId) return;
            setListVisibility(option.key, workspaceId);
          },
        };
      }),
    [listVisibility, setListVisibility, t, workspaceId],
  );

  if (!workspaceId) return null;

  const current = OPTIONS.find((option) => option.key === listVisibility) ?? OPTIONS[0];
  const currentLabel = t(current.labelKey as never);

  return (
    <DropdownMenu items={menuItems} open={open} onOpenChange={setOpen}>
      <ActionIcon
        icon={current.icon}
        size={DESKTOP_HEADER_ICON_SMALL_SIZE}
        title={`${t('resources.visibility.label')}: ${currentLabel}`}
      />
    </DropdownMenu>
  );
});

ResourceModeToggle.displayName = 'ResourceModeToggle';

export default ResourceModeToggle;

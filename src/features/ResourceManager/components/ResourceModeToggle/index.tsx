'use client';

import { type DropdownItem, DropdownMenu, Flexbox, Icon, type MenuInfo } from '@lobehub/ui';
import { Button, Text } from '@lobehub/ui/base-ui';
import { cssVar } from 'antd-style';
import { CheckIcon, ChevronDownIcon, LockIcon, UsersIcon } from 'lucide-react';
import { memo, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useActiveWorkspaceId } from '@/business/client/hooks/useActiveWorkspaceId';
import { useResourceManagerStore } from '@/features/ResourceManager/store';
import type { ResourceListVisibilityFilter } from '@/features/ResourceManager/store/initialState';

const OPTIONS: Array<{
  icon: typeof LockIcon;
  key: ResourceListVisibilityFilter;
  labelKey: string;
  tooltipKey: string;
}> = [
  {
    icon: LockIcon,
    key: 'private',
    labelKey: 'resources.visibility.private',
    tooltipKey: 'resources.mode.privateHint',
  },
  {
    icon: UsersIcon,
    key: 'workspace',
    labelKey: 'resources.visibility.workspace',
    tooltipKey: 'resources.mode.workspaceHint',
  },
];

/**
 * Sidebar-header scope chip, mirroring the task list's visibility filter.
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
      <Button
        size={'small'}
        style={{ paddingInline: 6 }}
        title={`${t('resources.visibility.label')}: ${currentLabel}`}
        type={'text'}
      >
        <Flexbox horizontal align={'center'} gap={4}>
          <Icon color={cssVar.colorIcon} icon={current.icon} size={14} />
          <Text ellipsis fontSize={12} style={{ maxWidth: 96 }} type={'secondary'}>
            {currentLabel}
          </Text>
          <Icon color={cssVar.colorIcon} icon={ChevronDownIcon} size={12} />
        </Flexbox>
      </Button>
    </DropdownMenu>
  );
});

ResourceModeToggle.displayName = 'ResourceModeToggle';

export default ResourceModeToggle;

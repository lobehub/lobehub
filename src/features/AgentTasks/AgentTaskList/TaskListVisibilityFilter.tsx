'use client';

import { ActionIcon, type DropdownItem, DropdownMenu, Icon, type MenuInfo } from '@lobehub/ui';
import { cssVar } from 'antd-style';
import { Globe, LockIcon, UsersIcon } from 'lucide-react';
import { memo, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useActiveWorkspaceId } from '@/business/client/hooks/useActiveWorkspaceId';
import { DESKTOP_HEADER_ICON_SMALL_SIZE } from '@/const/layoutTokens';
import { useTaskStore } from '@/store/task';
import { taskListSelectors } from '@/store/task/selectors';
import type { TaskListVisibilityFilter as Filter } from '@/store/task/slices/list/initialState';

import { renderMenuCheck } from '../features/menuExtra';

const FILTER_OPTIONS: Array<{ icon: typeof Globe; key: Filter; labelKey: string }> = [
  {
    icon: LockIcon,
    key: 'private',
    labelKey: 'createTask.visibility.private',
  },
  {
    icon: UsersIcon,
    key: 'workspace',
    labelKey: 'createTask.visibility.workspace',
  },
  {
    icon: Globe,
    key: 'all',
    labelKey: 'taskList.visibility.all',
  },
];

/**
 * Tasks page top-level visibility chip — narrows the (already ownership-
 * filtered) list to private / workspace-shared / all. Personal-mode users
 * don't see the chip; visibility filtering is meaningless without other
 * workspace members.
 */
const TaskListVisibilityFilter = memo(() => {
  const { t } = useTranslation('chat');
  const activeWorkspaceId = useActiveWorkspaceId();
  const visibility = useTaskStore(taskListSelectors.listVisibility);
  const setListVisibility = useTaskStore((s) => s.setListVisibility);
  const [open, setOpen] = useState(false);

  const currentOption = FILTER_OPTIONS.find((opt) => opt.key === visibility) ?? FILTER_OPTIONS[0];
  const CurrentIcon = currentOption.icon;

  const menuItems = useMemo<DropdownItem[]>(
    () =>
      FILTER_OPTIONS.map((option) => {
        const OptionIcon = option.icon;
        return {
          extra: renderMenuCheck(option.key === visibility),
          icon: <Icon color={cssVar.colorTextSecondary} icon={OptionIcon} size={16} />,
          key: option.key,
          label: t(option.labelKey as never),
          onClick: ({ domEvent }: MenuInfo) => {
            domEvent.stopPropagation();
            setListVisibility(option.key);
          },
        };
      }),
    [setListVisibility, t, visibility],
  );

  if (!activeWorkspaceId) return null;

  const currentLabel = t(currentOption.labelKey as never);

  return (
    <DropdownMenu items={menuItems} open={open} onOpenChange={setOpen}>
      <ActionIcon
        icon={CurrentIcon}
        size={DESKTOP_HEADER_ICON_SMALL_SIZE}
        title={`${t('taskList.visibility.label', { defaultValue: 'Visibility' })}: ${currentLabel}`}
      />
    </DropdownMenu>
  );
});

TaskListVisibilityFilter.displayName = 'TaskListVisibilityFilter';

export default TaskListVisibilityFilter;

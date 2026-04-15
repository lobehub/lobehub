import type { IconType } from '@lobehub/icons';
import { Icon, Tooltip } from '@lobehub/ui';
import { Dropdown, type MenuProps } from 'antd';
import { cssVar } from 'antd-style';
import { Loader2Icon } from 'lucide-react';
import type { ReactNode } from 'react';
import { memo, useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useTaskStore } from '@/store/task';

import PriorityHighIcon from './icons/PriorityHighIcon';
import PriorityLowIcon from './icons/PriorityLowIcon';
import PriorityMediumIcon from './icons/PriorityMediumIcon';
import PriorityNoneIcon from './icons/PriorityNoneIcon';
import PriorityUrgentIcon from './icons/PriorityUrgentIcon';

interface PriorityMeta {
  icon: IconType;
  labelKey: string;
  level: number;
}

const PRIORITY_META: Record<number, PriorityMeta> = {
  0: { icon: PriorityNoneIcon, labelKey: 'priority.none', level: 0 },
  1: { icon: PriorityUrgentIcon, labelKey: 'priority.urgent', level: 1 },
  2: { icon: PriorityHighIcon, labelKey: 'priority.high', level: 2 },
  3: { icon: PriorityMediumIcon, labelKey: 'priority.normal', level: 3 },
  4: { icon: PriorityLowIcon, labelKey: 'priority.low', level: 4 },
};

interface TaskPriorityTagProps {
  children?: ReactNode;
  disableDropdown?: boolean;
  priority?: number | null;
  size?: number;
  taskIdentifier: string;
}

const TaskPriorityTag = memo<TaskPriorityTagProps>(
  ({ children, disableDropdown, size = 16, priority, taskIdentifier }) => {
    const [loading, setLoading] = useState(false);
    const isUrgent = priority === 1;
    const { t } = useTranslation('chat');
    const updateTask = useTaskStore((s) => s.updateTask);
    const refreshTaskList = useTaskStore((s) => s.refreshTaskList);

    const meta = PRIORITY_META[priority ?? 0] ?? PRIORITY_META[0];

    const handlePriorityChange = useCallback(
      async (nextPriority: number) => {
        if (nextPriority === (priority ?? 0)) return;
        setLoading(true);
        await updateTask(taskIdentifier, { priority: nextPriority });
        await refreshTaskList();
        setLoading(false);
      },
      [priority, refreshTaskList, taskIdentifier, updateTask],
    );

    const menuItems = useMemo<MenuProps['items']>(
      () =>
        Object.entries(PRIORITY_META).map(([key, value]) => {
          const level = Number(key);
          const IconRender = value.icon;
          const isUrgentLevel = value.level === 1;
          return {
            icon: (
              <IconRender
                color={isUrgentLevel ? cssVar.orange : cssVar.colorTextDescription}
                size={16}
              />
            ),
            key,
            extra: value.level,
            label: t(`taskDetail.${value.labelKey}`),
            onClick: ({ domEvent }) => {
              domEvent.stopPropagation();
              void handlePriorityChange(level);
            },
          };
        }),
      [handlePriorityChange, t],
    );

    const IconRender = meta.icon;

    const triggerNode = children ? (
      children
    ) : loading ? (
      <Icon spin color={cssVar.colorTextDescription} icon={Loader2Icon} size={size} />
    ) : (
      <Tooltip title={t(`taskDetail.${meta.labelKey}`)}>
        <IconRender
          color={isUrgent ? cssVar.orange : cssVar.colorTextDescription}
          size={size}
          onClick={(e) => e.stopPropagation()}
        />
      </Tooltip>
    );

    if (disableDropdown) return <>{triggerNode}</>;

    return (
      <Dropdown
        trigger={['click']}
        menu={{
          items: menuItems,
          selectedKeys: [String(priority ?? 0)],
        }}
      >
        {triggerNode}
      </Dropdown>
    );
  },
);

export default TaskPriorityTag;

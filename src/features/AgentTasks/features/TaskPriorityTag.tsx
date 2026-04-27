import type { IconType } from '@lobehub/icons';
import { Icon, Tooltip } from '@lobehub/ui';
import { Dropdown, type MenuProps } from 'antd';
import { createStaticStyles, cssVar } from 'antd-style';
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
import { renderMenuExtra } from './menuExtra';

interface PriorityMeta {
  icon: IconType;
  label: string;
  labelKey: string;
  level: number;
}

export const PRIORITY_META: Record<number, PriorityMeta> = {
  0: { icon: PriorityNoneIcon, label: 'No priority', labelKey: 'priority.none', level: 0 },
  1: { icon: PriorityUrgentIcon, label: 'Urgent', labelKey: 'priority.urgent', level: 1 },
  2: { icon: PriorityHighIcon, label: 'High', labelKey: 'priority.high', level: 2 },
  3: { icon: PriorityMediumIcon, label: 'Normal', labelKey: 'priority.normal', level: 3 },
  4: { icon: PriorityLowIcon, label: 'Low', labelKey: 'priority.low', level: 4 },
};

const styles = createStaticStyles(({ css, cssVar }) => ({
  trigger: css`
    cursor: pointer;

    display: inline-flex;
    align-items: center;

    color: ${cssVar.colorTextDescription};

    transition: color ${cssVar.motionDurationMid};

    &:hover {
      color: ${cssVar.colorText};
    }
  `,
  triggerUrgent: css`
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    color: ${cssVar.orange};
  `,
}));

interface TaskPriorityTagProps {
  children?: ReactNode;
  disableDropdown?: boolean;
  onChange?: (priority: number) => void;
  priority?: number | null;
  size?: number;
  taskIdentifier?: string;
}

const TaskPriorityTag = memo<TaskPriorityTagProps>(
  ({ children, disableDropdown, onChange, size = 16, priority, taskIdentifier }) => {
    const [loading, setLoading] = useState(false);
    const { t } = useTranslation('chat');
    const updateTask = useTaskStore((s) => s.updateTask);
    const refreshTaskList = useTaskStore((s) => s.refreshTaskList);

    const currentLevel = priority ?? 0;
    const meta = PRIORITY_META[currentLevel] ?? PRIORITY_META[0];

    const handlePriorityChange = useCallback(
      async (nextPriority: number) => {
        if (nextPriority === currentLevel) return;
        if (onChange) {
          onChange(nextPriority);
          return;
        }
        if (!taskIdentifier) return;
        setLoading(true);
        await updateTask(taskIdentifier, { priority: nextPriority });
        await refreshTaskList();
        setLoading(false);
      },
      [currentLevel, onChange, refreshTaskList, taskIdentifier, updateTask],
    );

    const menuItems = useMemo<MenuProps['items']>(
      () =>
        Object.entries(PRIORITY_META).map(([key, value], index) => {
          const level = Number(key);
          const IconRender = value.icon;
          const isUrgentLevel = value.level === 1;
          const isCurrent = level === currentLevel;
          return {
            extra: renderMenuExtra(String(index + 1), isCurrent),
            icon: (
              <IconRender
                color={isUrgentLevel ? cssVar.orange : cssVar.colorTextSecondary}
                size={16}
              />
            ),
            key,
            label: t(`taskDetail.${value.labelKey}` as never, { defaultValue: value.label }),
            onClick: ({ domEvent }) => {
              domEvent.stopPropagation();
              void handlePriorityChange(level);
            },
          };
        }),
      [currentLevel, handlePriorityChange, t],
    );

    const IconRender = meta.icon;
    const isUrgent = currentLevel === 1;

    const triggerNode = children ? (
      children
    ) : loading ? (
      <Icon spin color={cssVar.colorTextDescription} icon={Loader2Icon} size={size} />
    ) : (
      <Tooltip title={t(`taskDetail.${meta.labelKey}` as never, { defaultValue: meta.label })}>
        <span
          className={isUrgent ? styles.triggerUrgent : styles.trigger}
          onClick={(e) => e.stopPropagation()}
        >
          <IconRender size={size} />
        </span>
      </Tooltip>
    );

    if (disableDropdown) return <>{triggerNode}</>;

    return (
      <Dropdown
        trigger={['click']}
        menu={{
          items: menuItems,
          selectedKeys: [String(currentLevel)],
        }}
      >
        {triggerNode}
      </Dropdown>
    );
  },
);

export default TaskPriorityTag;

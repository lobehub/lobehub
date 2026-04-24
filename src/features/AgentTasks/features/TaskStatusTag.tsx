import type { TaskStatus } from '@lobechat/types';
import { Icon, Tooltip } from '@lobehub/ui';
import { Dropdown, type MenuProps } from 'antd';
import { createStaticStyles, cssVar } from 'antd-style';
import type { LucideIcon } from 'lucide-react';
import {
  CircleCheck,
  CircleDashed,
  CircleDot,
  CircleSlash,
  CircleX,
  HandIcon,
  Loader2Icon,
} from 'lucide-react';
import type { ReactNode } from 'react';
import { memo, useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useTaskStore } from '@/store/task';

import { renderMenuExtra } from './menuExtra';

interface StatusMeta {
  color: string;
  icon: LucideIcon;
  label: string;
  labelKey: string;
}

export const STATUS_META: Record<TaskStatus, StatusMeta> = {
  backlog: {
    color: cssVar.colorTextQuaternary,
    icon: CircleDashed,
    label: 'Backlog',
    labelKey: 'status.backlog',
  },
  canceled: {
    color: cssVar.colorTextSecondary,
    icon: CircleSlash,
    label: 'Canceled',
    labelKey: 'status.canceled',
  },
  completed: {
    color: cssVar.colorSuccess,
    icon: CircleCheck,
    label: 'Completed',
    labelKey: 'status.completed',
  },
  failed: {
    color: cssVar.colorError,
    icon: CircleX,
    label: 'Failed',
    labelKey: 'status.failed',
  },
  paused: {
    color: cssVar.colorInfo,
    icon: HandIcon,
    label: 'Pending review',
    labelKey: 'status.paused',
  },
  running: {
    color: cssVar.colorWarning,
    icon: CircleDot,
    label: 'Running',
    labelKey: 'status.running',
  },
};

export const USER_SELECTABLE_STATUSES: TaskStatus[] = [
  'backlog',
  'paused',
  'completed',
  'canceled',
];

const styles = createStaticStyles(({ css, cssVar }) => ({
  trigger: css`
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    transition: filter ${cssVar.motionDurationMid};

    &:hover {
      filter: brightness(0.85);
    }
  `,
}));

interface TaskStatusTagProps {
  children?: ReactNode;
  disableDropdown?: boolean;
  onChange?: (status: TaskStatus) => void;
  size?: number;
  status?: TaskStatus;
  taskIdentifier?: string;
}

const TaskStatusTag = memo<TaskStatusTagProps>(
  ({ children, disableDropdown, onChange, size = 16, status, taskIdentifier }) => {
    const [loading, setLoading] = useState(false);
    const { t } = useTranslation('chat');
    const updateTaskStatus = useTaskStore((s) => s.updateTaskStatus);

    const displayStatus = status ?? 'backlog';
    const meta = STATUS_META[displayStatus];

    const handleStatusChange = useCallback(
      async (nextStatus: TaskStatus) => {
        if (nextStatus === displayStatus) return;
        if (onChange) {
          onChange(nextStatus);
          return;
        }
        if (!taskIdentifier) return;
        setLoading(true);

        try {
          await updateTaskStatus(taskIdentifier, nextStatus);
        } finally {
          setLoading(false);
        }
      },
      [displayStatus, onChange, taskIdentifier, updateTaskStatus],
    );

    const menuItems = useMemo<MenuProps['items']>(
      () =>
        USER_SELECTABLE_STATUSES.map((key, index) => {
          const statusMeta = STATUS_META[key];
          const isCurrent = key === displayStatus;
          return {
            extra: renderMenuExtra(String(index + 1), isCurrent),
            icon: <Icon color={statusMeta.color} icon={statusMeta.icon} size={16} />,
            key,
            label: t(`taskDetail.${statusMeta.labelKey}`, { defaultValue: statusMeta.label }),
            onClick: ({ domEvent }) => {
              domEvent.stopPropagation();
              void handleStatusChange(key);
            },
          };
        }),
      [displayStatus, handleStatusChange, t],
    );

    const triggerNode =
      children ||
      (loading ? (
        <Icon spin color={cssVar.colorTextDescription} icon={Loader2Icon} size={size} />
      ) : (
        <Tooltip title={t(`taskDetail.${meta.labelKey}`, { defaultValue: meta.label })}>
          <span className={styles.trigger} onClick={(e) => e.stopPropagation()}>
            <Icon color={meta.color} icon={meta.icon} size={size} />
          </span>
        </Tooltip>
      ));

    if (disableDropdown) return <>{triggerNode}</>;

    return (
      <Dropdown
        trigger={['click']}
        menu={{
          items: menuItems,
          selectedKeys: [displayStatus],
        }}
      >
        {triggerNode}
      </Dropdown>
    );
  },
);

export default TaskStatusTag;

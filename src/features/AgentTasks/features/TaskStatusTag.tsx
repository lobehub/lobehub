import type { TaskStatus } from '@lobechat/types';
import { Icon, Tooltip } from '@lobehub/ui';
import { Dropdown, type MenuProps } from 'antd';
import { cssVar } from 'antd-style';
import type { LucideIcon } from 'lucide-react';
import {
  CircleCheck,
  CircleDashed,
  CircleDot,
  CirclePause,
  CircleSlash,
  CircleX,
  Loader2Icon,
} from 'lucide-react';
import type { ReactNode } from 'react';
import { memo, useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useTaskStore } from '@/store/task';

interface StatusMeta {
  color: string;
  icon: LucideIcon;
  label: string;
  labelKey: string;
}

const STATUS_META: Record<TaskStatus, StatusMeta> = {
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
    color: cssVar.colorWarning,
    icon: CirclePause,
    label: 'Paused',
    labelKey: 'status.paused',
  },
  running: {
    color: cssVar.colorInfo,
    icon: CircleDot,
    label: 'Running',
    labelKey: 'status.running',
  },
};

const USER_SELECTABLE_STATUSES: TaskStatus[] = ['backlog', 'completed', 'canceled'];

interface TaskStatusTagProps {
  children?: ReactNode;
  disableDropdown?: boolean;
  size?: number;
  status?: TaskStatus;
  taskIdentifier: string;
}

const TaskStatusTag = memo<TaskStatusTagProps>(
  ({ children, disableDropdown, size = 16, status, taskIdentifier }) => {
    const [loading, setLoading] = useState(false);
    const { t } = useTranslation('chat');
    const updateTaskStatus = useTaskStore((s) => s.updateTaskStatus);

    const displayStatus = status ?? 'backlog';
    const meta = STATUS_META[displayStatus];

    const handleStatusChange = useCallback(
      async (nextStatus: TaskStatus) => {
        if (nextStatus === displayStatus) return;
        setLoading(true);

        try {
          await updateTaskStatus(taskIdentifier, nextStatus);
        } finally {
          setLoading(false);
        }
      },
      [displayStatus, taskIdentifier, updateTaskStatus],
    );

    const menuItems = useMemo<MenuProps['items']>(
      () =>
        USER_SELECTABLE_STATUSES.map((key) => {
          const statusMeta = STATUS_META[key];
          return {
            icon: <Icon color={statusMeta.color} icon={statusMeta.icon} size={16} />,
            key,
            label: t(`taskDetail.${statusMeta.labelKey}`, { defaultValue: statusMeta.label }),
            onClick: ({ domEvent }) => {
              domEvent.stopPropagation();
              void handleStatusChange(key);
            },
          };
        }),
      [handleStatusChange, t],
    );

    const triggerNode =
      children ||
      (loading ? (
        <Icon spin color={cssVar.colorTextDescription} icon={Loader2Icon} size={size} />
      ) : (
        <Tooltip title={t(`taskDetail.${meta.labelKey}`, { defaultValue: meta.label })}>
          <Icon
            color={meta.color}
            icon={meta.icon}
            size={size}
            onClick={(e) => e.stopPropagation()}
          />
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

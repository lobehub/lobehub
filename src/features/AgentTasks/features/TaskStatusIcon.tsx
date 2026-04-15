import { ActionIcon } from '@lobehub/ui';
import { cssVar } from 'antd-style';
import type { LucideIcon } from 'lucide-react';
import {
  CircleCheck,
  CircleDashed,
  CircleDot,
  CirclePause,
  CircleSlash,
  CircleX,
} from 'lucide-react';
import { memo } from 'react';

import { taskListSelectors } from '@/store/task/selectors';

type TaskStatus = 'backlog' | 'canceled' | 'completed' | 'failed' | 'paused' | 'running';

interface StatusMeta {
  color: string;
  icon: LucideIcon;
}

const STATUS_META: Record<TaskStatus, StatusMeta> = {
  backlog: { color: cssVar.colorTextQuaternary, icon: CircleDashed },
  canceled: { color: cssVar.colorTextSecondary, icon: CircleSlash },
  completed: { color: cssVar.colorSuccess, icon: CircleCheck },
  failed: { color: cssVar.colorError, icon: CircleX },
  paused: { color: cssVar.colorWarning, icon: CirclePause },
  running: { color: cssVar.colorInfo, icon: CircleDot },
};

interface TaskStatusIconProps {
  size?: number;
  status: 'backlog' | 'canceled' | 'completed' | 'failed' | 'paused' | 'running';
}

const TaskStatusIcon = memo<TaskStatusIconProps>(({ size = 16, status }) => {
  const displayStatus = taskListSelectors.getDisplayStatus(status);
  const { color, icon } = STATUS_META[status as TaskStatus] ?? STATUS_META.backlog;

  return (
    <ActionIcon
      color={color}
      icon={icon}
      title={displayStatus}
      size={{
        blockSize: size,
        size,
        borderRadius: '50%',
        strokeWidth: 3,
      }}
    />
  );
});

export default TaskStatusIcon;

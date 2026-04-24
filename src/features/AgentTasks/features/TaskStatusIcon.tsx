import { ActionIcon } from '@lobehub/ui';
import { cssVar } from 'antd-style';
import type { LucideIcon } from 'lucide-react';
import { CircleCheck, CircleDashed, CircleDot, CircleSlash, CircleX, HandIcon } from 'lucide-react';
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
  paused: { color: cssVar.colorInfo, icon: HandIcon },
  running: { color: cssVar.colorWarning, icon: CircleDot },
};

interface TaskStatusIconProps {
  size?: number;
  status: 'backlog' | 'canceled' | 'completed' | 'failed' | 'paused' | 'running';
}

const TaskStatusIcon = memo<TaskStatusIconProps>(({ size = 16, status }) => {
  const displayStatus = taskListSelectors.getDisplayStatus(status);
  const meta = STATUS_META[status as TaskStatus] ?? STATUS_META.backlog;

  return (
    <ActionIcon
      color={meta.color}
      icon={meta.icon}
      title={displayStatus}
      size={{
        blockSize: size,
        size,
        borderRadius: '50%',
      }}
    />
  );
});

export default TaskStatusIcon;

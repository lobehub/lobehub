import { Flexbox, Text } from '@lobehub/ui';
import { cssVar } from 'antd-style';
import dayjs from 'dayjs';
import { CheckCircle2, Circle } from 'lucide-react';
import { memo, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';

import { useAgentStore } from '@/store/agent';
import { taskListSelectors } from '@/store/task/selectors';
import type { TaskListItem } from '@/store/task/slices/list/initialState';

import { styles } from './style';

const statusColorMap: Record<string, string> = {
  backlog: cssVar.colorTextQuaternary,
  canceled: cssVar.colorTextQuaternary,
  completed: cssVar.colorSuccess,
  failed: cssVar.colorWarning,
  paused: cssVar.colorWarning,
  running: cssVar.colorInfo,
};

const formatTime = (time?: string | Date | null) => {
  if (!time) return '';
  const d = dayjs(time);
  return d.isSame(dayjs(), 'day') ? d.format('HH:mm') : d.fromNow();
};

interface TaskItemProps {
  task: TaskListItem;
}

const TaskItem = memo<TaskItemProps>(({ task }) => {
  const agentId = useAgentStore((s) => s.activeAgentId);
  const navigate = useNavigate();

  const displayStatus = taskListSelectors.getDisplayStatus(task.status);
  const color = statusColorMap[task.status] ?? cssVar.colorTextQuaternary;
  const isDone = task.status === 'completed';
  const time = formatTime(task.updatedAt);
  const StatusIcon = isDone ? CheckCircle2 : Circle;

  const handleClick = useCallback(() => {
    if (agentId) navigate(`/agent/${agentId}/tasks/${task.identifier}`);
  }, [agentId, navigate, task.identifier]);

  return (
    <div className={styles.item} onClick={handleClick}>
      <Flexbox flex={1} gap={4} style={{ minWidth: 0 }}>
        <Text ellipsis style={{ fontSize: 15 }} weight="bold">
          {task.name || task.identifier}
        </Text>
        {task.description && (
          <Text
            ellipsis
            style={{ color: cssVar.colorTextDescription, fontSize: cssVar.fontSizeSM }}
          >
            {task.description}
          </Text>
        )}
      </Flexbox>
      <Flexbox align="flex-end" gap={4} style={{ flexShrink: 0 }}>
        <Flexbox horizontal align="center" gap={6}>
          <StatusIcon
            color={color}
            fill={isDone ? color : 'none'}
            size={16}
            strokeWidth={isDone ? 0 : 2}
          />
          <span style={{ color: cssVar.colorText, fontSize: cssVar.fontSizeSM, fontWeight: 500 }}>
            {displayStatus}
          </span>
        </Flexbox>
        {time && (
          <span style={{ color: cssVar.colorTextTertiary, fontSize: cssVar.fontSizeSM }}>
            {time}
          </span>
        )}
      </Flexbox>
    </div>
  );
});

export default TaskItem;

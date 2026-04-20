import type { TaskStatus } from '@lobechat/types';
import { Block, Text } from '@lobehub/ui';
import { useThemeMode } from 'antd-style';
import { memo } from 'react';

import { useTaskStore } from '@/store/task';
import { taskDetailSelectors } from '@/store/task/selectors';

import AssigneeAgentSelector from '../features/AssigneeAgentSelector';
import AssigneeAvatar from '../features/AssigneeAvatar';
import { useAgentDisplayMeta } from '../shared/useAgentDisplayMeta';

const TaskDetailAssignee = memo(() => {
  const taskId = useTaskStore(taskDetailSelectors.activeTaskId);
  const status = useTaskStore(taskDetailSelectors.activeTaskStatus) as TaskStatus | undefined;
  const assigneeAgentId = useTaskStore(taskDetailSelectors.activeTaskAgentId);
  const assigneeMeta = useAgentDisplayMeta(assigneeAgentId);
  const { isDarkMode } = useThemeMode();

  if (!taskId || !assigneeAgentId) return null;

  return (
    <AssigneeAgentSelector
      currentAgentId={assigneeAgentId}
      disabled={status === 'running'}
      taskIdentifier={taskId}
    >
      <Block
        clickable
        horizontal
        align="center"
        gap={8}
        paddingBlock={4}
        paddingInline={11}
        style={{ minHeight: 32 }}
        variant={isDarkMode ? 'filled' : 'outlined'}
      >
        <AssigneeAvatar agentId={assigneeAgentId} size={20} />
        <Text weight={500}>{assigneeMeta?.title}</Text>
      </Block>
    </AssigneeAgentSelector>
  );
});

export default TaskDetailAssignee;

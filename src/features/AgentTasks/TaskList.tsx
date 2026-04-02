import { Center, Flexbox, Text } from '@lobehub/ui';
import { cssVar } from 'antd-style';
import { memo } from 'react';

import TaskItem from '@/features/AgentTaskList/TaskItem';
import { useTaskStore } from '@/store/task';
import { taskListSelectors } from '@/store/task/selectors';

const TaskList = memo(() => {
  const tasks = useTaskStore(taskListSelectors.taskList);
  const isInit = useTaskStore(taskListSelectors.isTaskListInit);

  if (!isInit) return null;

  if (tasks.length === 0) {
    return (
      <Center paddingBlock={48}>
        <Text style={{ color: cssVar.colorTextTertiary }}>No tasks yet</Text>
      </Center>
    );
  }

  return (
    <Flexbox gap={8}>
      {tasks.map((task) => (
        <TaskItem key={task.identifier} task={task} />
      ))}
    </Flexbox>
  );
});

export default TaskList;

import { Flexbox } from '@lobehub/ui';
import { memo } from 'react';

import { useAgentStore } from '@/store/agent';
import { useTaskStore } from '@/store/task';
import { taskListSelectors } from '@/store/task/selectors';

import { styles } from './style';
import TaskItem from './TaskItem';
import TaskListHeader from './TaskListHeader';

const MAX_DISPLAY = 5;

const AgentTaskList = memo(() => {
  const agentId = useAgentStore((s) => s.activeAgentId);
  const useFetchTaskList = useTaskStore((s) => s.useFetchTaskList);
  useFetchTaskList(agentId);

  const tasks = useTaskStore(taskListSelectors.taskList);
  const isInit = useTaskStore(taskListSelectors.isTaskListInit);

  if (!isInit || tasks.length === 0) return null;

  const displayTasks = tasks.slice(0, MAX_DISPLAY);

  return (
    <div className={styles.container}>
      <TaskListHeader />
      <Flexbox gap={8}>
        {displayTasks.map((task) => (
          <TaskItem key={task.identifier} task={task} />
        ))}
      </Flexbox>
    </div>
  );
});

export default AgentTaskList;

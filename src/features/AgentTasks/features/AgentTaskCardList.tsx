import { Block, Flexbox } from '@lobehub/ui';
import { Divider } from 'antd';
import { Fragment, memo, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';

import { useAgentStore } from '@/store/agent';
import { useTaskStore } from '@/store/task';
import { taskListSelectors } from '@/store/task/selectors';

import AgentTaskItem from './AgentTaskItem';
import TaskListHeader from './TaskListHeader';

const MAX_DISPLAY = 5;

const toTime = (value: Date | string | null | undefined): number => {
  if (!value) return 0;
  return value instanceof Date ? value.getTime() : new Date(value).getTime();
};

const AgentTaskCardList = memo(() => {
  const agentId = useAgentStore((s) => s.activeAgentId);
  const navigate = useNavigate();
  const useFetchTaskList = useTaskStore((s) => s.useFetchTaskList);
  useFetchTaskList({ agentId });

  const tasks = useTaskStore(taskListSelectors.taskList);
  const isInit = useTaskStore(taskListSelectors.isTaskListInit);

  const handleViewAll = useCallback(() => {
    if (agentId) navigate(`/agent/${agentId}/tasks`);
  }, [agentId, navigate]);

  const displayTasks = useMemo(
    () =>
      [...tasks]
        .sort((a, b) => {
          const updatedA = toTime(a.updatedAt) || toTime(a.createdAt);
          const updatedB = toTime(b.updatedAt) || toTime(b.createdAt);
          if (updatedA !== updatedB) return updatedB - updatedA;
          return a.identifier.localeCompare(b.identifier);
        })
        .slice(0, MAX_DISPLAY),
    [tasks],
  );

  if (!isInit || tasks.length === 0) return null;

  return (
    <Block shadow variant={'outlined'}>
      <TaskListHeader count={tasks.length} onViewAll={handleViewAll} />
      <Divider style={{ margin: 0 }} />
      <Flexbox gap={2} padding={2}>
        {displayTasks.map((task, index) => (
          <Fragment key={task.identifier}>
            <AgentTaskItem task={task} />
            {index !== displayTasks.length - 1 && <Divider dashed style={{ margin: 0 }} />}
          </Fragment>
        ))}
      </Flexbox>
    </Block>
  );
});

export default AgentTaskCardList;

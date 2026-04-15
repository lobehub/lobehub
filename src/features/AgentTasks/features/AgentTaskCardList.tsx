import { Block, Flexbox } from '@lobehub/ui';
import { Divider } from 'antd';
import { Fragment, memo, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';

import { useAgentStore } from '@/store/agent';
import { useTaskStore } from '@/store/task';
import { taskListSelectors } from '@/store/task/selectors';

import AgentTaskItem from './AgentTaskItem';
import TaskListHeader from './TaskListHeader';

const MAX_DISPLAY = 5;

const AgentTaskCardList = memo(() => {
  const agentId = useAgentStore((s) => s.activeAgentId);
  const navigate = useNavigate();
  const useFetchTaskList = useTaskStore((s) => s.useFetchTaskList);
  useFetchTaskList(agentId);

  const tasks = useTaskStore(taskListSelectors.taskList);
  const isInit = useTaskStore(taskListSelectors.isTaskListInit);

  const handleViewAll = useCallback(() => {
    if (agentId) navigate(`/agent/${agentId}/tasks`);
  }, [agentId, navigate]);

  if (!isInit || tasks.length === 0) return null;

  const displayTasks = tasks.slice(0, MAX_DISPLAY);

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

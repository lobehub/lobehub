import { Flexbox } from '@lobehub/ui';
import { memo } from 'react';

import { useTaskStore } from '@/store/task';

import Breadcrumb from './Breadcrumb';
import { styles } from './style';
import TaskList from './TaskList';
import TasksHeader from './TasksHeader';

interface AgentTasksPageProps {
  agentId: string;
}

const AgentTasksPage = memo<AgentTasksPageProps>(({ agentId }) => {
  const useFetchTaskList = useTaskStore((s) => s.useFetchTaskList);
  useFetchTaskList(agentId);

  return (
    <Flexbox flex={1} height={'100%'}>
      <Breadcrumb agentId={agentId} />
      <div className={styles.container}>
        <div className={styles.content}>
          <TasksHeader />
          <TaskList />
        </div>
      </div>
    </Flexbox>
  );
});

export default AgentTasksPage;

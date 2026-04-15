import { Flexbox } from '@lobehub/ui';
import { memo, useCallback } from 'react';

import NavHeader from '@/features/NavHeader';
import WideScreenContainer from '@/features/WideScreenContainer';
import { useGlobalStore } from '@/store/global';
import { systemStatusSelectors } from '@/store/global/selectors';
import { useTaskStore } from '@/store/task';

import Breadcrumb from '../shared/Breadcrumb';
import type { TaskListViewOptions } from './listViewOptions';
import { normalizeTaskListViewOptions } from './listViewOptions';
import TaskList from './TaskList';
import TasksGroupConfig from './TasksGroupConfig';

interface AgentTasksPageProps {
  agentId: string;
}

const AgentTasksPage = memo<AgentTasksPageProps>(({ agentId }) => {
  const useFetchTaskList = useTaskStore((s) => s.useFetchTaskList);
  useFetchTaskList(agentId);
  const rawViewOptions = useGlobalStore(systemStatusSelectors.taskListViewOptions);
  const viewOptions = normalizeTaskListViewOptions(rawViewOptions);
  const updateSystemStatus = useGlobalStore((s) => s.updateSystemStatus);
  const setViewOptions = useCallback(
    (updater: (prev: TaskListViewOptions) => TaskListViewOptions) => {
      const next = normalizeTaskListViewOptions(updater(viewOptions));
      updateSystemStatus({ taskListViewOptions: next }, 'updateTaskListViewOptions');
    },
    [updateSystemStatus, viewOptions],
  );

  return (
    <Flexbox flex={1} height={'100%'}>
      <NavHeader
        left={<Breadcrumb agentId={agentId} />}
        right={
          <>
            <TasksGroupConfig options={viewOptions} setOptions={setViewOptions} />
          </>
        }
        styles={{
          left: {
            paddingLeft: 4,
            gap: 8,
          },
        }}
      />
      <WideScreenContainer>
        <TaskList options={viewOptions} />
      </WideScreenContainer>
    </Flexbox>
  );
});

export default AgentTasksPage;

import { ActionIcon, Flexbox } from '@lobehub/ui';
import { Plus } from 'lucide-react';
import { memo, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';

import { DESKTOP_HEADER_ICON_SIZE } from '@/const/layoutTokens';
import NavHeader from '@/features/NavHeader';
import WideScreenContainer from '@/features/WideScreenContainer';
import { useGlobalStore } from '@/store/global';
import { systemStatusSelectors } from '@/store/global/selectors';
import { useTaskStore } from '@/store/task';

import { createTaskModal } from '../CreateTaskModal';
import Breadcrumb from '../shared/Breadcrumb';
import type { TaskListViewOptions } from './listViewOptions';
import { normalizeTaskListViewOptions } from './listViewOptions';
import TaskList from './TaskList';
import TasksGroupConfig from './TasksGroupConfig';

interface AgentTasksPageProps {
  /**
   * When omitted, the page shows tasks across all agents (used by the `/tasks` route).
   */
  agentId?: string;
}

const AgentTasksPage = memo<AgentTasksPageProps>(({ agentId }) => {
  const navigate = useNavigate();
  const useFetchTaskList = useTaskStore((s) => s.useFetchTaskList);
  useFetchTaskList({ agentId, allAgents: !agentId });
  const rawViewOptions = useGlobalStore(systemStatusSelectors.taskListViewOptions);
  const viewOptions = useMemo(() => normalizeTaskListViewOptions(rawViewOptions), [rawViewOptions]);
  const updateSystemStatus = useGlobalStore((s) => s.updateSystemStatus);
  const setViewOptions = useCallback(
    (updater: (prev: TaskListViewOptions) => TaskListViewOptions) => {
      const next = normalizeTaskListViewOptions(updater(viewOptions));
      updateSystemStatus({ taskListViewOptions: next }, 'updateTaskListViewOptions');
    },
    [updateSystemStatus, viewOptions],
  );

  const handleCreateTask = useCallback(() => {
    createTaskModal({
      agentId,
      onCreated: (task) => {
        const targetAgentId = task.agentId || agentId;
        if (targetAgentId) {
          navigate(`/agent/${targetAgentId}/tasks/${task.identifier}`);
        }
      },
    });
  }, [agentId, navigate]);

  return (
    <Flexbox flex={1} height={'100%'}>
      <NavHeader
        left={<Breadcrumb agentId={agentId} />}
        right={
          <Flexbox horizontal align={'center'} gap={4}>
            <ActionIcon icon={Plus} size={DESKTOP_HEADER_ICON_SIZE} onClick={handleCreateTask} />
            <TasksGroupConfig options={viewOptions} setOptions={setViewOptions} />
          </Flexbox>
        }
        styles={{
          left: {
            paddingLeft: 4,
            gap: 8,
          },
        }}
      />
      <WideScreenContainer wrapperStyle={{ flex: 1, overflowY: 'auto' }}>
        <TaskList options={viewOptions} />
      </WideScreenContainer>
    </Flexbox>
  );
});

export default AgentTasksPage;

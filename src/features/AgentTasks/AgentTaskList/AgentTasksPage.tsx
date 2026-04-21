import { ActionIcon, Flexbox } from '@lobehub/ui';
import { Plus } from 'lucide-react';
import { memo, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';

import AutoSaveHint from '@/components/Editor/AutoSaveHint';
import { DESKTOP_HEADER_ICON_SIZE } from '@/const/layoutTokens';
import NavHeader from '@/features/NavHeader';
import WideScreenContainer from '@/features/WideScreenContainer';
import { useGlobalStore } from '@/store/global';
import { systemStatusSelectors } from '@/store/global/selectors';
import { useTaskStore } from '@/store/task';
import { taskDetailSelectors, taskListSelectors } from '@/store/task/selectors';

import { createTaskModal } from '../CreateTaskModal';
import Breadcrumb from '../shared/Breadcrumb';
import CreateTaskInlineEntry from './CreateTaskInlineEntry';
import KanbanBoard from './KanbanBoard';
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
  const viewMode = useTaskStore(taskListSelectors.viewMode);
  const saveStatus = useTaskStore(taskDetailSelectors.taskSaveStatus);
  const useFetchTaskList = useTaskStore((s) => s.useFetchTaskList);
  useFetchTaskList({ agentId, allAgents: !agentId });
  const rawViewOptions = useGlobalStore(systemStatusSelectors.taskListViewOptions);
  const viewOptions = useMemo(() => normalizeTaskListViewOptions(rawViewOptions), [rawViewOptions]);
  const inlineCollapsed = useGlobalStore(systemStatusSelectors.taskCreateInlineCollapsed);
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
        left={
          <>
            <Breadcrumb agentId={agentId} />
            {saveStatus !== 'idle' && <AutoSaveHint saveStatus={saveStatus} />}
          </>
        }
        right={
          <Flexbox horizontal align={'center'} gap={4}>
            {inlineCollapsed && (
              <ActionIcon icon={Plus} size={DESKTOP_HEADER_ICON_SIZE} onClick={handleCreateTask} />
            )}
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
      {viewMode === 'kanban' ? (
        <Flexbox flex={1} style={{ overflowX: 'auto', overflowY: 'hidden' }}>
          <KanbanBoard agentId={agentId} />
        </Flexbox>
      ) : (
        <WideScreenContainer gap={16} paddingBlock={16} wrapperStyle={{ flex: 1, overflowY: 'auto' }}>
          {!inlineCollapsed && <CreateTaskInlineEntry agentId={agentId} />}
          <TaskList options={viewOptions} />
        </WideScreenContainer>
      )}
    </Flexbox>
  );
});

export default AgentTasksPage;

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
import { taskListSelectors } from '@/store/task/selectors';

import { createTaskModal } from '../CreateTaskModal';
import Breadcrumb from '../shared/Breadcrumb';
import CreateTaskInlineEntry from './CreateTaskInlineEntry';
import KanbanBoard from './KanbanBoard';
import type { TaskListViewOptions } from './listViewOptions';
import { normalizeTaskListViewOptions } from './listViewOptions';
import TaskList from './TaskList';
import TasksGroupConfig from './TasksGroupConfig';

const AgentTasksPage = memo(() => {
  const navigate = useNavigate();
  const viewMode = useTaskStore(taskListSelectors.viewMode);
  const useFetchTaskList = useTaskStore((s) => s.useFetchTaskList);
  useFetchTaskList({ allAgents: true });
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
      onCreated: (task) => {
        navigate(`/task/${task.identifier}`);
      },
    });
  }, [navigate]);

  const handleShowHiddenCompleted = useCallback(() => {
    setViewOptions((prev) => ({ ...prev, hideCompleted: false }));
  }, [setViewOptions]);

  return (
    <Flexbox flex={1} height={'100%'}>
      <NavHeader
        left={<Breadcrumb />}
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
          <KanbanBoard />
        </Flexbox>
      ) : (
        <WideScreenContainer
          gap={16}
          paddingBlock={16}
          wrapperStyle={{ flex: 1, overflowY: 'auto' }}
        >
          {!inlineCollapsed && <CreateTaskInlineEntry />}
          <TaskList options={viewOptions} onShowHiddenCompleted={handleShowHiddenCompleted} />
        </WideScreenContainer>
      )}
    </Flexbox>
  );
});

export default AgentTasksPage;

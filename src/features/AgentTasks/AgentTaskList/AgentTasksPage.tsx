import { ActionIcon, Flexbox } from '@lobehub/ui';
import { Plus } from 'lucide-react';
import { memo, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';

import { DESKTOP_HEADER_ICON_SIZE } from '@/const/layoutTokens';
import NavHeader from '@/features/NavHeader';
import ToggleRightPanelButton from '@/features/RightPanel/ToggleRightPanelButton';
import WideScreenContainer from '@/features/WideScreenContainer';
import { useIsMobile } from '@/hooks/useIsMobile';
import { useGlobalStore } from '@/store/global';
import { systemStatusSelectors } from '@/store/global/selectors';
import { useTaskStore } from '@/store/task';
import { taskListSelectors } from '@/store/task/selectors';

import { createTaskModal } from '../CreateTaskModal';
import Breadcrumb from '../shared/Breadcrumb';
import CreateTaskInlineEntry from './CreateTaskInlineEntry';
import EmptyState from './EmptyState';
import KanbanBoard from './KanbanBoard';
import type { TaskListViewOptions } from './listViewOptions';
import { normalizeTaskListViewOptions } from './listViewOptions';
import { shouldRenderTaskAgentPanelToggle } from './taskAgentPanelToggle';
import TaskList from './TaskList';
import TasksGroupConfig from './TasksGroupConfig';

const AgentTasksPage = memo(() => {
  const navigate = useNavigate();
  const isMobile = useIsMobile();
  const viewMode = useTaskStore(taskListSelectors.viewMode);
  const useFetchTaskList = useTaskStore((s) => s.useFetchTaskList);
  useFetchTaskList({ allAgents: true });
  const isEmptyHero = useTaskStore(taskListSelectors.isListEmpty);
  const rawViewOptions = useGlobalStore(systemStatusSelectors.taskListViewOptions);
  const viewOptions = useMemo(() => normalizeTaskListViewOptions(rawViewOptions), [rawViewOptions]);
  const inlineCollapsed = useGlobalStore(systemStatusSelectors.taskCreateInlineCollapsed);
  const [showTaskAgentPanel, toggleTaskAgentPanel] = useGlobalStore((s) => [
    systemStatusSelectors.showTaskAgentPanel(s),
    s.toggleTaskAgentPanel,
  ]);
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

  const showTaskAgentPanelToggle = shouldRenderTaskAgentPanelToggle(isMobile);

  return (
    <Flexbox flex={1} height={'100%'}>
      <NavHeader
        left={<Breadcrumb />}
        right={
          <Flexbox horizontal align={'center'} gap={4}>
            {(inlineCollapsed || viewMode === 'kanban') && (
              <ActionIcon icon={Plus} size={DESKTOP_HEADER_ICON_SIZE} onClick={handleCreateTask} />
            )}
            <TasksGroupConfig options={viewOptions} setOptions={setViewOptions} />
            {showTaskAgentPanelToggle && (
              <ToggleRightPanelButton
                hideWhenExpanded
                expand={showTaskAgentPanel}
                onToggle={() => toggleTaskAgentPanel()}
              />
            )}
          </Flexbox>
        }
        styles={{
          left: {
            paddingLeft: 4,
            gap: 8,
          },
        }}
      />
      {isEmptyHero ? (
        <EmptyState />
      ) : viewMode === 'kanban' ? (
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

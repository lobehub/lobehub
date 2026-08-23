import { ActionIcon, Flexbox } from '@lobehub/ui';
import { TabsIndicator, TabsList, TabsRoot, TabsTab } from '@lobehub/ui/base-ui';
import { Pagination } from 'antd';
import { Plus } from 'lucide-react';
import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router';

import { DESKTOP_HEADER_ICON_SMALL_SIZE } from '@/const/layoutTokens';
import NavHeader from '@/features/NavHeader';
import ToggleRightPanelButton from '@/features/RightPanel/ToggleRightPanelButton';
import WideScreenContainer from '@/features/WideScreenContainer';
import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import { useIsMobile } from '@/hooks/useIsMobile';
import { usePermission } from '@/hooks/usePermission';
import { useGlobalStore } from '@/store/global';
import type { TaskViewMode } from '@/store/global/initialState';
import { systemStatusSelectors } from '@/store/global/selectors';
import { useTaskStore } from '@/store/task';
import { taskListSelectors } from '@/store/task/selectors';

import { createTaskModal } from '../CreateTaskModal';
import Breadcrumb from '../shared/Breadcrumb';
import { taskDetailPath } from '../shared/taskDetailPath';
import CreateTaskInlineEntry from './CreateTaskInlineEntry';
import EmptyState from './EmptyState';
import KanbanBoard from './KanbanBoard';
import type { TaskListViewOptions } from './listViewOptions';
import { normalizeTaskListViewOptions } from './listViewOptions';
import { shouldRenderTaskAgentPanelToggle } from './taskAgentPanelToggle';
import TaskList from './TaskList';
import TaskListVisibilityFilter from './TaskListVisibilityFilter';
import TasksGroupConfig from './TasksGroupConfig';

interface TaskCreateActionBehaviorParams {
  canCreateTask: boolean;
  inlineCollapsed: boolean;
  viewMode: TaskViewMode;
}

export const getTaskCreateActionBehavior = ({
  canCreateTask,
  inlineCollapsed,
  viewMode,
}: TaskCreateActionBehaviorParams) => {
  const shouldExpandInline = inlineCollapsed && viewMode === 'list';

  return {
    disabled: shouldExpandInline ? false : !canCreateTask,
    mode: shouldExpandInline ? 'inline' : 'modal',
  } as const;
};

interface TaskPageHeaderVisibilityParams {
  agentId?: string;
  isEmptyHero: boolean;
  isMobile: boolean;
}

export const getTaskPageHeaderVisibility = ({
  agentId,
  isEmptyHero,
  isMobile,
}: TaskPageHeaderVisibilityParams) => {
  const isGlobalEmpty = !agentId && isEmptyHero;

  return {
    showBreadcrumb: !isGlobalEmpty,
    showTaskAgentPanelToggle: !isGlobalEmpty && shouldRenderTaskAgentPanelToggle(isMobile),
    showViewOptions: !isGlobalEmpty,
  };
};

interface AgentTasksPageProps {
  /**
   * When provided, the page is scoped to a single agent's tasks; otherwise it
   * shows tasks across all agents.
   */
  agentId?: string;
  /** When provided, shows the complete task workspace scoped to one project. */
  projectId?: string;
}

type TaskCollection = 'scheduled' | 'tasks';
const SCHEDULED_TASK_PAGE_SIZE = 50;

export const resolveTaskCollection = (searchParams: URLSearchParams): TaskCollection =>
  searchParams.get('collection') === 'scheduled' ? 'scheduled' : 'tasks';

export const clampScheduledPage = (page: number, total: number): number =>
  Math.min(page, Math.max(1, Math.ceil(total / SCHEDULED_TASK_PAGE_SIZE)));

const AgentTasksPage = memo<AgentTasksPageProps>(({ agentId, projectId }) => {
  const { t } = useTranslation('chat');
  const navigate = useWorkspaceAwareNavigate();
  const isMobile = useIsMobile();
  const { allowed: canCreateTask, reason } = usePermission('create_content');
  const viewMode = useGlobalStore(systemStatusSelectors.taskListViewMode);
  const [searchParams, setSearchParams] = useSearchParams();
  const [scheduledPage, setScheduledPage] = useState(1);
  const canSwitchCollection = !agentId && !projectId;
  const collection = canSwitchCollection ? resolveTaskCollection(searchParams) : 'tasks';
  const isScheduledCollection = canSwitchCollection && collection === 'scheduled';
  const useFetchTaskList = useTaskStore((s) => s.useFetchTaskList);
  // Keep the SWR handle only for `error` + `mutate` (the error/Retry state).
  const { error, isLoading, mutate } = useFetchTaskList(
    projectId
      ? { projectId, visibility: 'all' }
      : agentId
        ? { agentId }
        : { allAgents: true, automated: false },
  );
  // Drive the loading/empty boundary off the store's own init flag, NOT SWR's
  // per-key `data`. On a scope (agent ↔ all) or visibility switch the store
  // resets `tasks` + `isTaskListInit` together (`scopeChangeResetState`), but
  // SWR still holds cached `data` for the target key — so keying `hasSettled`
  // off SWR `data` made it `true` while `tasks` was empty and flashed the "no
  // tasks" empty during the refetch. `isTaskListInit` flips true only on the
  // current scope's success and resets in lockstep with `tasks`, so the settled
  // signal never disagrees with the emptiness signal. Still resets to false on a
  // failed first load, so we surface loading only while there's no error (below).
  const isTaskListInit = useTaskStore(taskListSelectors.isTaskListInit);
  const isEmptyHero = useTaskStore(taskListSelectors.isListEmpty);
  const useFetchScheduledTaskList = useTaskStore((s) => s.useFetchScheduledTaskList);
  const scheduledSWR = useFetchScheduledTaskList({
    enabled: isScheduledCollection,
    limit: SCHEDULED_TASK_PAGE_SIZE,
    offset: (scheduledPage - 1) * SCHEDULED_TASK_PAGE_SIZE,
  });
  const scheduledTasks = scheduledSWR.data?.data ?? [];
  const scheduledTasksTotal = scheduledSWR.data?.total ?? 0;
  const isScheduledTaskListInit = scheduledSWR.data !== undefined;
  const rawViewOptions = useGlobalStore(systemStatusSelectors.taskListViewOptions);
  const viewOptions = useMemo(() => normalizeTaskListViewOptions(rawViewOptions), [rawViewOptions]);
  const scheduledViewOptions = useMemo(
    () => ({ ...viewOptions, groupBy: 'automationMode' as const, hideCompleted: false }),
    [viewOptions],
  );
  useEffect(() => {
    if (!isScheduledTaskListInit) return;
    setScheduledPage((page) => clampScheduledPage(page, scheduledTasksTotal));
  }, [isScheduledTaskListInit, scheduledTasksTotal]);
  const inlineCollapsed = useGlobalStore(systemStatusSelectors.taskCreateInlineCollapsed);
  const [showTaskAgentPanel, toggleTaskAgentPanel] = useGlobalStore((s) => [
    systemStatusSelectors.showTaskAgentPanel(s),
    s.toggleTaskAgentPanel,
  ]);
  const updateSystemStatus = useGlobalStore((s) => s.updateSystemStatus);
  const routeScope = agentId ? 'agent' : 'global';
  const setViewOptions = useCallback(
    (updater: (prev: TaskListViewOptions) => TaskListViewOptions) => {
      const normalized = normalizeTaskListViewOptions(updater(viewOptions));
      const next = {
        ...normalized,
        groupBy: normalized.groupBy === 'automationMode' ? 'status' : normalized.groupBy,
        subGroupBy: normalized.subGroupBy === 'automationMode' ? 'none' : normalized.subGroupBy,
      };
      updateSystemStatus({ taskListViewOptions: next }, 'updateTaskListViewOptions');
    },
    [updateSystemStatus, viewOptions],
  );

  const createActionBehavior = useMemo(
    () =>
      getTaskCreateActionBehavior({
        canCreateTask,
        inlineCollapsed,
        viewMode,
      }),
    [canCreateTask, inlineCollapsed, viewMode],
  );

  const handleCreateTask = useCallback(() => {
    if (createActionBehavior.mode === 'inline') {
      updateSystemStatus({ taskCreateInlineCollapsed: false }, 'expandTaskCreateInline');
      return;
    }

    if (!canCreateTask) return;
    createTaskModal({
      agentId,
      lockAssignee: !!agentId,
      projectId,
      onCreated: (task) => {
        navigate(taskDetailPath(task.identifier, agentId ? task.agentId : undefined));
      },
    });
  }, [agentId, canCreateTask, createActionBehavior.mode, navigate, projectId, updateSystemStatus]);

  const handleShowHiddenCompleted = useCallback(() => {
    setViewOptions((prev) => ({ ...prev, hideCompleted: false }));
  }, [setViewOptions]);

  const handleCollectionChange = useCallback(
    (value: string) => {
      const next = new URLSearchParams(searchParams);
      if (value === 'scheduled') {
        next.set('collection', 'scheduled');
      } else {
        next.delete('collection');
      }
      setScheduledPage(1);
      setSearchParams(next, { replace: true });
    },
    [searchParams, setSearchParams],
  );

  const headerVisibility = getTaskPageHeaderVisibility({
    agentId,
    isEmptyHero: isScheduledCollection ? false : isEmptyHero,
    isMobile,
  });

  const collectionTabs = canSwitchCollection ? (
    <TabsRoot size={'small'} value={collection} onValueChange={handleCollectionChange}>
      <TabsList>
        <TabsIndicator />
        <TabsTab value={'tasks'}>{t('taskList.title')}</TabsTab>
        <TabsTab value={'scheduled'}>{t('taskList.scheduled.title')}</TabsTab>
      </TabsList>
    </TabsRoot>
  ) : (
    <Breadcrumb />
  );

  return (
    <Flexbox flex={1} height={'100%'}>
      <NavHeader
        left={headerVisibility.showBreadcrumb || canSwitchCollection ? collectionTabs : undefined}
        right={
          <Flexbox horizontal align={'center'} gap={4}>
            {!isScheduledCollection && !agentId && !projectId && <TaskListVisibilityFilter />}
            {!isScheduledCollection && (inlineCollapsed || viewMode === 'kanban') && (
              <ActionIcon
                disabled={createActionBehavior.disabled}
                icon={Plus}
                size={DESKTOP_HEADER_ICON_SMALL_SIZE}
                title={createActionBehavior.disabled ? reason : undefined}
                onClick={handleCreateTask}
              />
            )}
            {!isScheduledCollection && headerVisibility.showViewOptions && (
              <TasksGroupConfig options={viewOptions} setOptions={setViewOptions} />
            )}
            {headerVisibility.showTaskAgentPanelToggle && (
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
      {isScheduledCollection ? (
        <WideScreenContainer
          fullWidth
          gap={16}
          paddingBlock={16}
          paddingInline={16}
          wrapperStyle={{ flex: 1, overflowY: 'auto' }}
        >
          <TaskList
            data={isScheduledTaskListInit || undefined}
            emptyDescription={t('taskList.scheduled.empty')}
            error={scheduledSWR.error}
            isLoading={scheduledSWR.isLoading || (!isScheduledTaskListInit && !scheduledSWR.error)}
            items={scheduledTasks}
            options={scheduledViewOptions}
            routeScope={routeScope}
            onRetry={() => scheduledSWR.mutate()}
          />
          {(scheduledTasksTotal > SCHEDULED_TASK_PAGE_SIZE || scheduledPage > 1) && (
            <Flexbox horizontal justify={'center'} paddingBlock={8}>
              <Pagination
                current={scheduledPage}
                pageSize={SCHEDULED_TASK_PAGE_SIZE}
                showSizeChanger={false}
                total={scheduledTasksTotal}
                onChange={setScheduledPage}
              />
            </Flexbox>
          )}
        </WideScreenContainer>
      ) : isEmptyHero ? (
        <EmptyState agentId={agentId} projectId={projectId} />
      ) : viewMode === 'kanban' ? (
        <Flexbox flex={1} style={{ overflowX: 'auto', overflowY: 'hidden' }}>
          <KanbanBoard agentId={agentId} projectId={projectId} routeScope={routeScope} />
        </Flexbox>
      ) : (
        <WideScreenContainer
          fullWidth
          gap={16}
          paddingBlock={16}
          paddingInline={16}
          wrapperStyle={{ flex: 1, overflowY: 'auto' }}
        >
          {!inlineCollapsed && (
            <CreateTaskInlineEntry
              agentId={agentId}
              lockAssignee={!!agentId}
              projectId={projectId}
            />
          )}
          <TaskList
            data={isTaskListInit || undefined}
            error={error}
            isLoading={isLoading || (!isTaskListInit && !error)}
            options={viewOptions}
            routeScope={routeScope}
            onRetry={() => mutate()}
            onShowHiddenCompleted={handleShowHiddenCompleted}
          />
        </WideScreenContainer>
      )}
    </Flexbox>
  );
});

export default AgentTasksPage;

import { Flexbox } from '@lobehub/ui';
import { ActionIcon, TabsIndicator, TabsList, TabsRoot, TabsTab } from '@lobehub/ui/base-ui';
import { Pagination } from 'antd';
import { Plus } from 'lucide-react';
import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router';

import { useActiveWorkspaceId } from '@/business/client/hooks/useActiveWorkspaceId';
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
import { getVisibleTaskStatuses, normalizeTaskListViewOptions } from './listViewOptions';
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
  projectId?: string;
}

export const getTaskPageHeaderVisibility = ({
  agentId,
  isEmptyHero,
  isMobile,
  projectId,
}: TaskPageHeaderVisibilityParams) => {
  // The global page's own crumb is the `tasks` tab, so the breadcrumb only
  // earns its place once the list is scoped to an agent or a project.
  const isScoped = !!(agentId || projectId);
  const isGlobalEmpty = !isScoped && isEmptyHero;

  return {
    showBreadcrumb: isScoped,
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

type TaskCollection = 'mine' | 'scheduled' | 'tasks';
/** "My tasks" sub-view: assigned to me as a member, or created by me. */
export type MyTaskScope = 'assigned' | 'created';
const COLLECTION_PAGE_SIZE = 50;

export const resolveTaskCollection = (
  searchParams: URLSearchParams,
  options: { allowMine?: boolean } = {},
): TaskCollection => {
  const value = searchParams.get('collection');
  if (value === 'scheduled') return 'scheduled';
  // The "My tasks" tab is only offered where member assignment exists; a deep
  // link into it from a scope without the tab falls back to ordinary tasks.
  if (value === 'mine' && options.allowMine) return 'mine';
  return 'tasks';
};

export const resolveMyTaskScope = (searchParams: URLSearchParams): MyTaskScope =>
  searchParams.get('scope') === 'created' ? 'created' : 'assigned';

export const clampCollectionPage = (page: number, total: number): number =>
  Math.min(page, Math.max(1, Math.ceil(total / COLLECTION_PAGE_SIZE)));

/**
 * View options every paginated (server-sliced) collection pins, because a
 * client-side reorder or cut would only ever apply to the fetched page:
 * - ordering follows the server's updatedAt DESC page order. `compareTaskItems`
 *   inverts `orderDirection` for the date columns (see
 *   `effectiveOrderDirection`), so the token that renders newest-first is 'asc';
 * - every fetched row renders. With `showSubTasks: false` `TaskList` folds a
 *   child away whenever its parent shares the page, which would leave the page
 *   sparse while `total` still counts the hidden rows. Nesting (when enabled)
 *   still tucks a child under a parent that is on the same page.
 * Grouping stays client-side — it only arranges the rows of the current page.
 */
const PAGINATED_COLLECTION_VIEW = {
  orderBy: 'updatedAt',
  orderDirection: 'asc',
  showSubTasks: true,
} as const;

export const getScheduledTaskViewOptions = (
  viewOptions: TaskListViewOptions,
): TaskListViewOptions => ({
  ...viewOptions,
  ...PAGINATED_COLLECTION_VIEW,
  groupBy: 'automationMode',
  hideCompleted: false,
});

/**
 * "My tasks" additionally sends `hideCompleted` as a server status filter
 * (`getVisibleTaskStatuses`) rather than applying it to the fetched page.
 */
export const getMyTaskViewOptions = (viewOptions: TaskListViewOptions): TaskListViewOptions => ({
  ...viewOptions,
  ...PAGINATED_COLLECTION_VIEW,
});

const AgentTasksPage = memo<AgentTasksPageProps>(({ agentId, projectId }) => {
  const { t } = useTranslation('chat');
  const navigate = useWorkspaceAwareNavigate();
  const isMobile = useIsMobile();
  const { allowed: canCreateTask, reason } = usePermission('create_content');
  const viewMode = useGlobalStore(systemStatusSelectors.taskListViewMode);
  const [searchParams, setSearchParams] = useSearchParams();
  const [collectionPage, setCollectionPage] = useState(1);
  const activeWorkspaceId = useActiveWorkspaceId();
  // Member assignment is a workspace concept (a task now carries a member
  // owner alongside its executor agent), so "My tasks" only earns its tab on
  // the global page of a workspace: personal mode has no members, and the
  // agent/project scopes keep their own focused lists.
  const showMineCollection = !!activeWorkspaceId && !agentId && !projectId;
  const collection = resolveTaskCollection(searchParams, { allowMine: showMineCollection });
  const isScheduledCollection = collection === 'scheduled';
  const isMineCollection = collection === 'mine';
  const isOrdinaryCollection = collection === 'tasks';
  const myTaskScope = resolveMyTaskScope(searchParams);
  const useFetchTaskList = useTaskStore((s) => s.useFetchTaskList);
  // Keep the SWR handle only for `error` + `mutate` (the error/Retry state).
  // Every scope splits automated work out of the ordinary tab — it is the
  // scheduled tab's content, and listing it twice makes the split meaningless.
  const { error, isLoading, mutate } = useFetchTaskList(
    projectId
      ? { automated: false, projectId, visibility: 'all' }
      : agentId
        ? { agentId, automated: false }
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
    agentId,
    enabled: isScheduledCollection,
    limit: COLLECTION_PAGE_SIZE,
    offset: (collectionPage - 1) * COLLECTION_PAGE_SIZE,
    projectId,
  });
  const rawViewOptions = useGlobalStore(systemStatusSelectors.taskListViewOptions);
  const viewOptions = useMemo(() => normalizeTaskListViewOptions(rawViewOptions), [rawViewOptions]);
  const useFetchMyTaskList = useTaskStore((s) => s.useFetchMyTaskList);
  const mineSWR = useFetchMyTaskList({
    enabled: isMineCollection,
    limit: COLLECTION_PAGE_SIZE,
    offset: (collectionPage - 1) * COLLECTION_PAGE_SIZE,
    scope: myTaskScope,
    statuses: getVisibleTaskStatuses(viewOptions),
  });
  // The scheduled and "My tasks" tabs share one paginated-list shape; pick the
  // active tab's SWR handle so the pagination/empty/error plumbing is written
  // once.
  const collectionSWR = isMineCollection ? mineSWR : scheduledSWR;
  const collectionTasks = collectionSWR.data?.data ?? [];
  const collectionTasksTotal = collectionSWR.data?.total ?? 0;
  const isCollectionListInit = collectionSWR.data !== undefined;
  const scheduledViewOptions = useMemo(
    () => getScheduledTaskViewOptions(viewOptions),
    [viewOptions],
  );
  const myTaskViewOptions = useMemo(() => getMyTaskViewOptions(viewOptions), [viewOptions]);
  useEffect(() => {
    if (!isCollectionListInit) return;
    setCollectionPage((page) => clampCollectionPage(page, collectionTasksTotal));
  }, [isCollectionListInit, collectionTasksTotal]);
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
      if (value === 'scheduled' || value === 'mine') {
        next.set('collection', value);
      } else {
        next.delete('collection');
      }
      // The sub-view only means something inside "My tasks".
      if (value !== 'mine') next.delete('scope');
      setCollectionPage(1);
      setSearchParams(next, { replace: true });
    },
    [searchParams, setSearchParams],
  );

  const handleMyTaskScopeChange = useCallback(
    (value: string) => {
      const next = new URLSearchParams(searchParams);
      if (value === 'created') {
        next.set('scope', 'created');
      } else {
        next.delete('scope');
      }
      setCollectionPage(1);
      setSearchParams(next, { replace: true });
    },
    [searchParams, setSearchParams],
  );

  const headerVisibility = getTaskPageHeaderVisibility({
    agentId,
    isEmptyHero: isOrdinaryCollection ? isEmptyHero : false,
    isMobile,
    projectId,
  });

  const headerLeft = (
    <Flexbox horizontal align={'center'} gap={8}>
      {headerVisibility.showBreadcrumb && <Breadcrumb />}
      <TabsRoot size={'small'} value={collection} onValueChange={handleCollectionChange}>
        <TabsList>
          <TabsIndicator />
          <TabsTab value={'tasks'}>{t('taskList.title')}</TabsTab>
          <TabsTab value={'scheduled'}>{t('taskList.scheduled.title')}</TabsTab>
          {showMineCollection && <TabsTab value={'mine'}>{t('taskList.mine.title')}</TabsTab>}
        </TabsList>
      </TabsRoot>
      {isMineCollection && (
        <TabsRoot size={'small'} value={myTaskScope} onValueChange={handleMyTaskScopeChange}>
          <TabsList>
            <TabsIndicator />
            <TabsTab value={'assigned'}>{t('taskList.mine.assigned')}</TabsTab>
            <TabsTab value={'created'}>{t('taskList.mine.created')}</TabsTab>
          </TabsList>
        </TabsRoot>
      )}
    </Flexbox>
  );

  return (
    <Flexbox flex={1} height={'100%'}>
      <NavHeader
        left={headerLeft}
        right={
          <Flexbox horizontal align={'center'} gap={4}>
            {isOrdinaryCollection && !agentId && !projectId && <TaskListVisibilityFilter />}
            {isOrdinaryCollection && (inlineCollapsed || viewMode === 'kanban') && (
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
      {!isOrdinaryCollection ? (
        <WideScreenContainer
          fullWidth
          gap={16}
          paddingBlock={16}
          paddingInline={16}
          wrapperStyle={{ flex: 1, overflowY: 'auto' }}
        >
          <TaskList
            data={isCollectionListInit || undefined}
            error={collectionSWR.error}
            isLoading={collectionSWR.isLoading || (!isCollectionListInit && !collectionSWR.error)}
            items={collectionTasks}
            options={isMineCollection ? myTaskViewOptions : scheduledViewOptions}
            routeScope={routeScope}
            emptyDescription={
              isMineCollection
                ? t(
                    myTaskScope === 'created'
                      ? 'taskList.mine.emptyCreated'
                      : 'taskList.mine.emptyAssigned',
                  )
                : t('taskList.scheduled.empty')
            }
            onRetry={() => collectionSWR.mutate()}
          />
          {(collectionTasksTotal > COLLECTION_PAGE_SIZE || collectionPage > 1) && (
            <Flexbox horizontal justify={'center'} paddingBlock={8}>
              <Pagination
                current={collectionPage}
                pageSize={COLLECTION_PAGE_SIZE}
                showSizeChanger={false}
                total={collectionTasksTotal}
                onChange={setCollectionPage}
              />
            </Flexbox>
          )}
        </WideScreenContainer>
      ) : isEmptyHero ? (
        <EmptyState agentId={agentId} projectId={projectId} />
      ) : viewMode === 'kanban' ? (
        <Flexbox flex={1} style={{ overflowX: 'auto', overflowY: 'hidden' }}>
          <KanbanBoard
            agentId={agentId}
            options={viewOptions}
            projectId={projectId}
            routeScope={routeScope}
          />
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

import {
  DndContext,
  type DragEndEvent,
  DragOverlay,
  type DragStartEvent,
  KeyboardSensor,
  PointerSensor,
  pointerWithin,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import { Center, createStaticStyles, Empty, Flexbox } from '@lobehub/ui';
import { ClipboardCheckIcon } from 'lucide-react';
import { memo, useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import AsyncBoundary from '@/components/AsyncBoundary';
import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import { usePermission } from '@/hooks/usePermission';
import { useAgentStore } from '@/store/agent';
import { builtinAgentSelectors } from '@/store/agent/selectors';
import { useGlobalStore } from '@/store/global';
import { systemStatusSelectors } from '@/store/global/selectors';
import { useTaskStore } from '@/store/task';
import { taskListSelectors } from '@/store/task/selectors';
import type { TaskListItem } from '@/store/task/slices/list/initialState';
import { saveToast } from '@/store/utils/saveToast';

import { createTaskModal } from '../CreateTaskModal';
import type { TaskItemRouteScope } from '../features/AgentTaskItem';
import AgentTaskItem from '../features/AgentTaskItem';
import { useTaskStatusChange } from '../features/useTaskStatusChange';
import { taskDetailPath } from '../shared/taskDetailPath';
import HiddenColumnsPanel from './HiddenColumnsPanel';
import {
  buildKanbanColumns,
  buildKanbanGroupQuery,
  canDropTaskIntoKanbanColumn,
  findKanbanTask,
  getKanbanAssigneeUpdate,
  getKanbanTaskPatch,
  moveTaskBetweenKanbanGroups,
  normalizeKanbanGroupBy,
} from './kanbanBoardModel';
import KanbanColumn, { COLUMN_I18N_KEYS, COLUMN_STATUS_ICON, COLUMN_WIDTH } from './KanbanColumn';
import type { TaskListViewOptions } from './listViewOptions';
import { HIDDEN_WHEN_COMPLETED_STATUSES } from './listViewOptions';

const styles = createStaticStyles(({ css }) => ({
  board: css`
    overflow-x: auto;
    display: flex;
    flex: 1;
    gap: 8px;

    padding-block: 0 16px;
    padding-inline: 12px;
  `,
}));

interface KanbanBoardProps {
  /** When set, scopes the board (and task creation) to a single agent. */
  agentId?: string;
  /** Overrides the generic "no tasks" copy with the collection's own line. */
  emptyDescription?: string;
  /**
   * "My tasks" board: narrows the server groups to the caller's own slice of
   * the workspace, matching what that tab's list view fetches — including its
   * lack of an automation filter.
   */
  myTaskScope?: 'assigned' | 'created';
  options: TaskListViewOptions;
  projectId?: string;
  routeScope?: TaskItemRouteScope;
}

const KanbanBoard = memo<KanbanBoardProps>((props) => {
  const { agentId, emptyDescription, myTaskScope, options, projectId, routeScope } = props;
  const { t } = useTranslation('chat');
  const navigate = useWorkspaceAwareNavigate();
  const { allowed: canEditTask } = usePermission('create_content');
  const groupBy = normalizeKanbanGroupBy(options.groupBy);
  const excludeStatuses = options.hideCompleted ? HIDDEN_WHEN_COMPLETED_STATUSES : undefined;

  const useFetchTaskGroupList = useTaskStore((s) => s.useFetchTaskGroupList);
  // Keep the sync handle for `error` + `mutate` (the error/Retry state) and the
  // `queryKey` the groups are read by.
  const { error, isLoading, mutate, queryKey } = useFetchTaskGroupList(
    buildKanbanGroupQuery({ agentId, excludeStatuses, groupBy, myTaskScope, projectId }),
  );
  // Each board query (scope, dimension, filters) is its own store entry, so the
  // settled signal and the groups always describe the same board.
  const isTaskGroupListInit = useTaskStore(taskListSelectors.isTaskGroupListInit(queryKey));
  const currentTaskGroups = useTaskStore(taskListSelectors.taskGroups(queryKey));
  const updateTask = useTaskStore((s) => s.updateTask);
  const runTask = useTaskStore((s) => s.runTask);
  const refreshTaskList = useTaskStore((s) => s.refreshTaskList);
  const inboxAgentId = useAgentStore(builtinAgentSelectors.inboxAgentId);
  const changeTaskStatus = useTaskStatusChange();

  const hiddenColumns = useGlobalStore(systemStatusSelectors.taskKanbanHiddenColumns);
  const hiddenPanelCollapsed = useGlobalStore(systemStatusSelectors.taskKanbanHiddenPanelCollapsed);
  const updateSystemStatus = useGlobalStore((s) => s.updateSystemStatus);

  const [activeTask, setActiveTask] = useState<TaskListItem | null>(null);
  const columns = useMemo(
    () => buildKanbanColumns(currentTaskGroups, groupBy),
    [currentTaskGroups, groupBy],
  );

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor),
  );

  const handleDragStart = useCallback(
    (event: DragStartEvent) => {
      if (!canEditTask) return;
      const task = event.active.data.current?.task as TaskListItem | undefined;
      setActiveTask(task ?? null);
    },
    [canEditTask],
  );

  /**
   * Assign-then-run as one action: a failure toast's Retry repeats both steps,
   * so retrying a failed assignment still starts the task.
   */
  const startTask = useCallback(
    (task: TaskListItem, onAssigned?: () => void): Promise<void> => {
      const start = async (afterAssign?: () => void): Promise<void> => {
        const retry = () => {
          start().catch(() => {});
        };
        const current =
          findKanbanTask(
            taskListSelectors.taskGroups(queryKey)(useTaskStore.getState()),
            task.identifier,
          ) ?? task;
        if (!current.assigneeAgentId && !current.assigneeUserId && inboxAgentId) {
          await updateTask(current.identifier, { assigneeAgentId: inboxAgentId }, { retry });
          afterAssign?.();
        }
        try {
          await runTask(current.identifier, undefined, { throwOnError: true });
        } catch (error) {
          saveToast(error, { retry, title: t('taskList.kanban.runFailed') });
          throw error;
        }
      };
      return start(onAssigned);
    },
    [inboxAgentId, queryKey, runTask, t, updateTask],
  );

  const handleDragEnd = useCallback(
    async (event: DragEndEvent) => {
      setActiveTask(null);
      if (!canEditTask) return;

      const { active, over } = event;
      if (!over) return;

      const targetColumnKey = over.id as string;
      const column = columns.find((item) => item.key === targetColumnKey);

      const task = active.data.current?.task as TaskListItem | undefined;
      if (!task) return;
      if (!column || !canDropTaskIntoKanbanColumn(task, groupBy, column)) return;

      const patch = getKanbanTaskPatch(groupBy, column);
      if (!patch) return;
      const assigneeUpdate =
        groupBy === 'assignee' || groupBy === 'member'
          ? getKanbanAssigneeUpdate(task, patch)
          : undefined;
      if (groupBy === 'status' && task.status === patch.status) return;
      if ((groupBy === 'assignee' || groupBy === 'member') && !assigneeUpdate) return;
      if (groupBy === 'priority' && (task.priority ?? 0) === (patch.priority ?? 0)) return;

      if (!queryKey) return;
      // The move is idempotent, so the overlay stays correct when the status
      // change also patches the card underneath it.
      const move = useTaskStore.getState().internal_beginTaskGroupOptimistic(queryKey, (value) => ({
        ...value,
        groups: moveTaskBetweenKanbanGroups(value.groups, task, targetColumnKey, patch),
      }));

      try {
        if (groupBy === 'status' && column.targetStatus === 'running') {
          // Dropping into "In progress" starts the task, same as "Run now". The
          // assignment refetches the groups (still backlog until the run
          // starts); the overlay is rebased onto that refetch, so the card
          // stays in "In progress".
          await startTask(task);
        } else if (groupBy === 'status' && column.targetStatus) {
          const changed = await changeTaskStatus(task.identifier, column.targetStatus);
          if (!changed) {
            move.rollback();
            return;
          }
        } else if ((groupBy === 'assignee' || groupBy === 'member') && assigneeUpdate) {
          await updateTask(task.identifier, assigneeUpdate);
        } else if (groupBy === 'priority') {
          await updateTask(task.identifier, { priority: patch.priority ?? 0 });
        }
        move.commit();
      } catch {
        move.rollback();
        // A failed start may already have persisted the fallback assignee.
        if (column.targetStatus === 'running') void refreshTaskList();
      }
    },
    [
      canEditTask,
      changeTaskStatus,
      columns,
      groupBy,
      queryKey,
      refreshTaskList,
      startTask,
      updateTask,
    ],
  );

  const handleDragCancel = useCallback(() => {
    setActiveTask(null);
  }, []);

  const handleCreateTask = useCallback(() => {
    if (!canEditTask) return;
    createTaskModal({
      agentId,
      lockAssignee: !!agentId,
      projectId,
      onCreated: (task) => {
        navigate(taskDetailPath(task.identifier, agentId ? task.agentId : undefined, task.name));
      },
      showInlineToggle: false,
    });
  }, [agentId, canEditTask, navigate, projectId]);

  const handleHideColumn = useCallback(
    (columnKey: string) => {
      const next = Array.from(new Set([...hiddenColumns, columnKey]));
      updateSystemStatus({ taskKanbanHiddenColumns: next }, 'hideKanbanColumn');
    },
    [hiddenColumns, updateSystemStatus],
  );

  const handleRestoreColumn = useCallback(
    (columnKey: string) => {
      const next = hiddenColumns.filter((key) => key !== columnKey);
      updateSystemStatus({ taskKanbanHiddenColumns: next }, 'restoreKanbanColumn');
    },
    [hiddenColumns, updateSystemStatus],
  );

  const handleToggleHiddenPanel = useCallback(
    (collapsed: boolean) => {
      updateSystemStatus({ taskKanbanHiddenPanelCollapsed: collapsed }, 'toggleKanbanHiddenPanel');
    },
    [updateSystemStatus],
  );

  const hiddenColumnSet = useMemo(() => new Set(hiddenColumns), [hiddenColumns]);

  const visibleColumns = useMemo(
    () =>
      groupBy === 'status' ? columns.filter((column) => !hiddenColumnSet.has(column.key)) : columns,
    [columns, groupBy, hiddenColumnSet],
  );

  const hiddenColumnEntries = useMemo(
    () =>
      columns
        .filter((col) => hiddenColumnSet.has(col.key))
        .map((col) => ({
          columnKey: col.key,
          label: t(COLUMN_I18N_KEYS[col.key] as any),
          statusIcon: COLUMN_STATUS_ICON[col.key],
          total: currentTaskGroups.find((group) => group.key === col.key)?.total ?? 0,
        })),
    [columns, currentTaskGroups, hiddenColumnSet, t],
  );

  const totalTasks = currentTaskGroups.reduce((sum, group) => sum + group.total, 0);
  const skeletonColumns =
    visibleColumns.length > 0
      ? visibleColumns
      : Array.from({ length: 3 }, (_, index) => ({
          droppable: false,
          groupMeta: undefined,
          key: `skeleton-${index}`,
          targetStatus: null,
        }));

  const skeletonBoard = (
    <Flexbox horizontal className={styles.board}>
      {skeletonColumns.map((col) => (
        <KanbanColumn
          loading
          columnKey={col.key}
          droppable={false}
          groupBy={groupBy}
          groupMeta={col.groupMeta}
          key={col.key}
          tasks={[]}
          total={0}
        />
      ))}
    </Flexbox>
  );

  const emptyState = (
    <Center height={'80vh'} width={'100%'}>
      <Empty description={emptyDescription ?? t('taskList.empty')} icon={ClipboardCheckIcon} />
    </Center>
  );

  const board = (
    <DndContext
      collisionDetection={pointerWithin}
      sensors={canEditTask ? sensors : []}
      onDragCancel={handleDragCancel}
      onDragEnd={handleDragEnd}
      onDragStart={handleDragStart}
    >
      <Flexbox horizontal className={styles.board}>
        {visibleColumns.map((col) => {
          const group = currentTaskGroups.find((item) => item.key === col.key);
          const droppable =
            canEditTask &&
            col.droppable &&
            (!activeTask || canDropTaskIntoKanbanColumn(activeTask, groupBy, col));
          return (
            <KanbanColumn
              columnKey={col.key}
              droppable={droppable}
              groupBy={groupBy}
              groupMeta={col.groupMeta}
              key={col.key}
              routeScope={routeScope}
              tasks={(group?.tasks ?? []) as TaskListItem[]}
              total={group?.total ?? 0}
              onHide={groupBy === 'status' ? () => handleHideColumn(col.key) : undefined}
              onCreate={
                // "My tasks" offers no create entry (its list view has none
                // either): a task created here carries neither the member
                // assignment nor — under `created` — any guarantee it lands
                // in the column it was started from.
                groupBy === 'status' && col.key === 'backlog' && !myTaskScope
                  ? handleCreateTask
                  : undefined
              }
            />
          );
        })}
        {groupBy === 'status' && (
          <HiddenColumnsPanel
            collapsed={hiddenPanelCollapsed}
            columns={hiddenColumnEntries}
            onRestore={handleRestoreColumn}
            onToggleCollapsed={handleToggleHiddenPanel}
          />
        )}
      </Flexbox>
      <DragOverlay dropAnimation={null}>
        {activeTask ? (
          <div
            style={{
              background: 'var(--lobe-color-bg-container, #fff)',
              border: '1px solid var(--lobe-color-border-secondary, #f0f0f0)',
              borderRadius: 8,
              boxShadow: '0 6px 16px 0 rgba(0, 0, 0, 0.08), 0 3px 6px -4px rgba(0, 0, 0, 0.12)',
              cursor: 'grabbing',
              width: COLUMN_WIDTH - 8,
            }}
          >
            <AgentTaskItem routeScope={routeScope} task={activeTask} variant="compact" />
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  );

  // Error gated ahead of empty by AsyncBoundary so a failed fetch shows Retry
  // instead of the "no tasks" empty. `data` is the SWR result —
  // undefined until the first fetch settles.
  return (
    <AsyncBoundary
      data={isTaskGroupListInit || undefined}
      empty={emptyState}
      error={error}
      errorVariant={'block'}
      isEmpty={totalTasks === 0}
      isLoading={isLoading || (!isTaskGroupListInit && !error)}
      loading={skeletonBoard}
      onRetry={() => mutate()}
    >
      {board}
    </AsyncBoundary>
  );
});

export default KanbanBoard;

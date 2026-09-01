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
import { Center, Empty, Flexbox } from '@lobehub/ui';
import { createStaticStyles } from 'antd-style';
import { ClipboardCheckIcon } from 'lucide-react';
import { memo, useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import AsyncBoundary from '@/components/AsyncBoundary';
import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import { usePermission } from '@/hooks/usePermission';
import { useGlobalStore } from '@/store/global';
import { systemStatusSelectors } from '@/store/global/selectors';
import { useTaskStore } from '@/store/task';
import { taskListSelectors } from '@/store/task/selectors';
import type { TaskListItem } from '@/store/task/slices/list/initialState';

import { createTaskModal } from '../CreateTaskModal';
import type { TaskItemRouteScope } from '../features/AgentTaskItem';
import AgentTaskItem from '../features/AgentTaskItem';
import { taskDetailPath } from '../shared/taskDetailPath';
import HiddenColumnsPanel from './HiddenColumnsPanel';
import {
  buildKanbanColumns,
  canDropTaskIntoKanbanColumn,
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
  options: TaskListViewOptions;
  projectId?: string;
  routeScope?: TaskItemRouteScope;
}

const KanbanBoard = memo<KanbanBoardProps>(({ agentId, options, projectId, routeScope }) => {
  const { t } = useTranslation('chat');
  const navigate = useWorkspaceAwareNavigate();
  const { allowed: canEditTask } = usePermission('create_content');
  const groupBy = normalizeKanbanGroupBy(options.groupBy);
  const excludeStatuses = options.hideCompleted ? HIDDEN_WHEN_COMPLETED_STATUSES : undefined;

  const useFetchTaskGroupList = useTaskStore((s) => s.useFetchTaskGroupList);
  // Keep the SWR handle only for `error` + `mutate` (the error/Retry state).
  const { error, isLoading, isQueryScopeCurrent, mutate } = useFetchTaskGroupList(
    projectId
      ? { automated: false, excludeStatuses, groupBy, projectId }
      : agentId
        ? { agentId, automated: false, excludeStatuses, groupBy }
        : { allAgents: true, automated: false, excludeStatuses, groupBy },
  );
  // Drive the loading/empty boundary off the store's own init flag, NOT SWR's
  // per-key `data`. On a scope or visibility switch the store resets
  // `taskGroups` + `isTaskGroupListInit` together (`scopeChangeResetState`)
  // while SWR still holds cached `data` for the target key — keying `hasSettled`
  // off SWR `data` flashed the "no tasks" empty board during the refetch.
  // `isTaskGroupListInit` resets in lockstep with `taskGroups`, so the settled
  // signal never disagrees with the emptiness signal.
  const isTaskGroupListInit = useTaskStore(taskListSelectors.isTaskGroupListInit);

  const taskGroups = useTaskStore(taskListSelectors.taskGroups);
  const currentTaskGroups = useMemo(
    () => (isQueryScopeCurrent ? taskGroups : []),
    [isQueryScopeCurrent, taskGroups],
  );
  const updateTask = useTaskStore((s) => s.updateTask);
  const updateTaskStatus = useTaskStore((s) => s.updateTaskStatus);

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

      const prevGroups = useTaskStore.getState().taskGroups;
      const nextGroups = moveTaskBetweenKanbanGroups(prevGroups, task, targetColumnKey, patch);
      useTaskStore.setState({ taskGroups: nextGroups }, false, 'kanban/optimisticMove');

      try {
        if (groupBy === 'status' && column.targetStatus) {
          await updateTaskStatus(task.identifier, column.targetStatus);
        } else if ((groupBy === 'assignee' || groupBy === 'member') && assigneeUpdate) {
          await updateTask(task.identifier, assigneeUpdate);
        } else if (groupBy === 'priority') {
          await updateTask(task.identifier, { priority: patch.priority ?? 0 });
        }
      } catch {
        useTaskStore.setState({ taskGroups: prevGroups }, false, 'kanban/revertMove');
      }
    },
    [canEditTask, columns, groupBy, updateTask, updateTaskStatus],
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
        navigate(taskDetailPath(task.identifier, agentId ? task.agentId : undefined));
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
      <Empty description={t('taskList.empty')} icon={ClipboardCheckIcon} />
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
                groupBy === 'status' && col.key === 'backlog' ? handleCreateTask : undefined
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
      data={(isQueryScopeCurrent && isTaskGroupListInit) || undefined}
      empty={emptyState}
      error={error}
      errorVariant={'block'}
      isEmpty={totalTasks === 0}
      isLoading={isLoading || (!isQueryScopeCurrent && !error) || (!isTaskGroupListInit && !error)}
      loading={skeletonBoard}
      onRetry={() => mutate()}
    >
      {board}
    </AsyncBoundary>
  );
});

export default KanbanBoard;

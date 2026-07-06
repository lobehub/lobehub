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
import type { TaskGroupItem, TaskListItem } from '@/store/task/slices/list/initialState';

import { createTaskModal } from '../CreateTaskModal';
import type { TaskItemRouteScope } from '../features/AgentTaskItem';
import AgentTaskItem from '../features/AgentTaskItem';
import { taskDetailPath } from '../shared/taskDetailPath';
import HiddenColumnsPanel from './HiddenColumnsPanel';
import KanbanColumn, { COLUMN_I18N_KEYS, COLUMN_STATUS_ICON, COLUMN_WIDTH } from './KanbanColumn';

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

interface ColumnDef {
  droppable: boolean;
  key: string;
  targetStatus: 'backlog' | 'canceled' | 'completed' | null;
}

const COLUMNS: ColumnDef[] = [
  { droppable: true, key: 'backlog', targetStatus: 'backlog' },
  { droppable: false, key: 'running', targetStatus: null },
  { droppable: false, key: 'needsInput', targetStatus: null },
  { droppable: true, key: 'done', targetStatus: 'completed' },
  { droppable: true, key: 'canceled', targetStatus: 'canceled' },
];

const optimisticMoveTask = (
  taskGroups: TaskGroupItem[],
  task: TaskListItem,
  targetColumnKey: string,
): TaskGroupItem[] => {
  return taskGroups.map((group) => {
    const filtered = (group.tasks as TaskListItem[]).filter(
      (t) => t.identifier !== task.identifier,
    );
    const removed = filtered.length < (group.tasks as TaskListItem[]).length;

    if (group.key === targetColumnKey) {
      return { ...group, tasks: [...filtered, task], total: filtered.length + 1 };
    }

    return removed ? { ...group, tasks: filtered, total: group.total - 1 } : group;
  });
};

interface KanbanBoardProps {
  /** When set, scopes the board (and task creation) to a single agent. */
  agentId?: string;
  routeScope?: TaskItemRouteScope;
}

const KanbanBoard = memo<KanbanBoardProps>(({ agentId, routeScope }) => {
  const { t } = useTranslation('chat');
  const navigate = useWorkspaceAwareNavigate();
  const { allowed: canEditTask } = usePermission('create_content');

  const useFetchTaskGroupList = useTaskStore((s) => s.useFetchTaskGroupList);
  // Keep the SWR handle only for `error` + `mutate` (the error/Retry state).
  const { error, isLoading, mutate } = useFetchTaskGroupList(
    agentId ? { agentId } : { allAgents: true },
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
  const updateTaskStatus = useTaskStore((s) => s.updateTaskStatus);

  const hiddenColumns = useGlobalStore(systemStatusSelectors.taskKanbanHiddenColumns);
  const hiddenPanelCollapsed = useGlobalStore(systemStatusSelectors.taskKanbanHiddenPanelCollapsed);
  const updateSystemStatus = useGlobalStore((s) => s.updateSystemStatus);

  const [activeTask, setActiveTask] = useState<TaskListItem | null>(null);

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
      const column = COLUMNS.find((c) => c.key === targetColumnKey);
      if (!column?.droppable || !column.targetStatus) return;

      const task = active.data.current?.task as TaskListItem | undefined;
      if (!task) return;

      if (task.status === column.targetStatus) return;

      const prevGroups = useTaskStore.getState().taskGroups;
      const nextGroups = optimisticMoveTask(prevGroups, task, targetColumnKey);
      useTaskStore.setState({ taskGroups: nextGroups }, false, 'kanban/optimisticMove');

      try {
        await updateTaskStatus(task.identifier, column.targetStatus);
      } catch {
        useTaskStore.setState({ taskGroups: prevGroups }, false, 'kanban/revertMove');
      }
    },
    [canEditTask, updateTaskStatus],
  );

  const handleDragCancel = useCallback(() => {
    setActiveTask(null);
  }, []);

  const handleCreateTask = useCallback(() => {
    if (!canEditTask) return;
    createTaskModal({
      agentId,
      lockAssignee: !!agentId,
      onCreated: (task) => {
        navigate(taskDetailPath(task.identifier, agentId ? task.agentId : undefined));
      },
      showInlineToggle: false,
    });
  }, [agentId, canEditTask, navigate]);

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
    () => COLUMNS.filter((col) => !hiddenColumnSet.has(col.key)),
    [hiddenColumnSet],
  );

  const hiddenColumnEntries = useMemo(
    () =>
      COLUMNS.filter((col) => hiddenColumnSet.has(col.key)).map((col) => ({
        columnKey: col.key,
        label: t(COLUMN_I18N_KEYS[col.key] as any),
        statusIcon: COLUMN_STATUS_ICON[col.key],
        total: taskGroups.find((group) => group.key === col.key)?.total ?? 0,
      })),
    [hiddenColumnSet, t, taskGroups],
  );

  const totalTasks = taskGroups.reduce((sum, g) => sum + g.total, 0);

  const skeletonBoard = (
    <Flexbox horizontal className={styles.board}>
      {visibleColumns.map((col) => (
        <KanbanColumn
          loading
          columnKey={col.key}
          droppable={false}
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
          const group = taskGroups.find((g) => g.key === col.key);
          return (
            <KanbanColumn
              columnKey={col.key}
              droppable={canEditTask && col.droppable}
              key={col.key}
              routeScope={routeScope}
              tasks={(group?.tasks ?? []) as TaskListItem[]}
              total={group?.total ?? 0}
              onCreate={col.key === 'backlog' ? handleCreateTask : undefined}
              onHide={() => handleHideColumn(col.key)}
            />
          );
        })}
        <HiddenColumnsPanel
          collapsed={hiddenPanelCollapsed}
          columns={hiddenColumnEntries}
          onRestore={handleRestoreColumn}
          onToggleCollapsed={handleToggleHiddenPanel}
        />
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
  // instead of the "no tasks" empty (LOBE-11181). `data` is the SWR result —
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

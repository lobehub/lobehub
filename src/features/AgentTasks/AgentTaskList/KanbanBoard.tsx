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
import { memo, useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useTaskStore } from '@/store/task';
import { taskListSelectors } from '@/store/task/selectors';
import type { TaskGroupItem, TaskListItem } from '@/store/task/slices/list/initialState';

import AgentTaskItem from '../features/AgentTaskItem';
import KanbanColumn, { COLUMN_WIDTH } from './KanbanColumn';

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
  targetStatus: 'backlog' | 'completed' | null;
}

const COLUMNS: ColumnDef[] = [
  { droppable: true, key: 'backlog', targetStatus: 'backlog' },
  { droppable: false, key: 'running', targetStatus: null },
  { droppable: false, key: 'needsInput', targetStatus: null },
  { droppable: true, key: 'done', targetStatus: 'completed' },
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
  agentId?: string;
}

const KanbanBoard = memo<KanbanBoardProps>(({ agentId }) => {
  const { t } = useTranslation('chat');

  const useFetchTaskGroupList = useTaskStore((s) => s.useFetchTaskGroupList);
  useFetchTaskGroupList(agentId);

  const taskGroups = useTaskStore(taskListSelectors.taskGroups);
  const isInit = useTaskStore(taskListSelectors.isTaskGroupListInit);
  const updateTaskStatus = useTaskStore((s) => s.updateTaskStatus);

  const [activeTask, setActiveTask] = useState<TaskListItem | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor),
  );

  const handleDragStart = useCallback((event: DragStartEvent) => {
    const task = event.active.data.current?.task as TaskListItem | undefined;
    setActiveTask(task ?? null);
  }, []);

  const handleDragEnd = useCallback(
    async (event: DragEndEvent) => {
      setActiveTask(null);

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
    [updateTaskStatus],
  );

  const handleDragCancel = useCallback(() => {
    setActiveTask(null);
  }, []);

  if (!isInit) return null;

  const totalTasks = taskGroups.reduce((sum, g) => sum + g.total, 0);

  if (totalTasks === 0) {
    return (
      <Center height={'80vh'} width={'100%'}>
        <Empty description={t('taskList.empty')} icon={ClipboardCheckIcon} />
      </Center>
    );
  }

  return (
    <DndContext
      collisionDetection={pointerWithin}
      sensors={sensors}
      onDragCancel={handleDragCancel}
      onDragEnd={handleDragEnd}
      onDragStart={handleDragStart}
    >
      <Flexbox horizontal className={styles.board}>
        {COLUMNS.map((col) => {
          const group = taskGroups.find((g) => g.key === col.key);
          return (
            <KanbanColumn
              columnKey={col.key}
              droppable={col.droppable}
              key={col.key}
              tasks={(group?.tasks ?? []) as TaskListItem[]}
              total={group?.total ?? 0}
            />
          );
        })}
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
            <AgentTaskItem task={activeTask} />
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
});

export default KanbanBoard;

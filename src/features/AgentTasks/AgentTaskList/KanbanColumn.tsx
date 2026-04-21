import { useDndContext, useDraggable, useDroppable } from '@dnd-kit/core';
import type { TaskStatus } from '@lobechat/types';
import { Text } from '@lobehub/ui';
import { createStaticStyles, cx } from 'antd-style';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import type { TaskListItem } from '@/store/task/slices/list/initialState';

import AgentTaskItem from '../features/AgentTaskItem';
import TaskStatusIcon from '../features/TaskStatusIcon';

export const COLUMN_WIDTH = 520;

const cardStyles = createStaticStyles(({ css, cssVar }) => ({
  card: css`
    cursor: grab;

    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: ${cssVar.borderRadiusLG};

    background: ${cssVar.colorBgContainer};

    transition: box-shadow 0.2s;

    &:hover {
      box-shadow: ${cssVar.boxShadowTertiary};
    }
  `,
  dragging: css`
    visibility: hidden;
  `,
}));

const DraggableTaskCard = memo<{ task: TaskListItem }>(({ task }) => {
  const { attributes, isDragging, listeners, setNodeRef } = useDraggable({
    data: { task },
    id: task.identifier,
  });

  return (
    <div
      className={cx(cardStyles.card, isDragging && cardStyles.dragging)}
      ref={setNodeRef}
      {...listeners}
      {...attributes}
    >
      <AgentTaskItem task={task} />
    </div>
  );
});

const styles = createStaticStyles(({ css, cssVar }) => ({
  body: css`
    overflow-y: auto;
    display: flex;
    flex: 1;
    flex-direction: column;
    gap: 6px;

    padding-block: 4px 16px;
    padding-inline: 4px;
  `,
  column: css`
    display: flex;
    flex-direction: column;
    flex-shrink: 0;

    width: ${COLUMN_WIDTH}px;
    max-height: 100%;

    transition: background 0.2s;
  `,
  dropActive: css`
    border-radius: ${cssVar.borderRadiusLG};
    background: ${cssVar.colorFillQuaternary};
  `,
  emptyText: css`
    padding-block: 24px;
    padding-inline: 16px;

    font-size: 13px;
    color: ${cssVar.colorTextQuaternary};
    text-align: center;
  `,
  header: css`
    display: flex;
    gap: 8px;
    align-items: center;

    padding-block: 8px 10px;
    padding-inline: 8px;
  `,
  notDroppable: css`
    pointer-events: none;
    opacity: 0.4;
  `,
}));

const COLUMN_I18N_KEYS: Record<string, string> = {
  backlog: 'taskList.kanban.backlog',
  done: 'taskList.kanban.done',
  needsInput: 'taskList.kanban.needsInput',
  running: 'taskList.kanban.running',
};

const COLUMN_STATUS_ICON: Record<string, TaskStatus> = {
  backlog: 'backlog',
  done: 'completed',
  needsInput: 'paused',
  running: 'running',
};

interface KanbanColumnProps {
  columnKey: string;
  droppable: boolean;
  tasks: TaskListItem[];
  total: number;
}

const KanbanColumn = memo<KanbanColumnProps>(({ columnKey, droppable, tasks, total }) => {
  const { t } = useTranslation('chat');
  const { active } = useDndContext();
  const { isOver, setNodeRef } = useDroppable({
    disabled: !droppable,
    id: columnKey,
  });

  const statusIcon = COLUMN_STATUS_ICON[columnKey];
  const i18nKey = COLUMN_I18N_KEYS[columnKey];
  const label = i18nKey ? t(i18nKey as any) : columnKey;
  const isDragActive = !!active;

  // Don't highlight if dragging a card that's already in this column
  const activeTask = active?.data.current?.task as TaskListItem | undefined;
  const isFromThisColumn = activeTask && tasks.some((t) => t.identifier === activeTask.identifier);
  const showDropHighlight = isOver && droppable && !isFromThisColumn;
  const showDisabled = isDragActive && !droppable;

  return (
    <div
      ref={setNodeRef}
      className={cx(
        styles.column,
        showDropHighlight && styles.dropActive,
        showDisabled && styles.notDroppable,
      )}
    >
      <div className={styles.header}>
        {statusIcon && <TaskStatusIcon size={18} status={statusIcon} />}
        <Text weight={500}>{label}</Text>
        <Text fontSize={12} type={'secondary'}>
          {total}
        </Text>
      </div>
      <div className={styles.body}>
        {tasks.length > 0 ? (
          tasks.map((task) => <DraggableTaskCard key={task.identifier} task={task} />)
        ) : (
          <div className={styles.emptyText}>{t('taskList.kanban.emptyColumn')}</div>
        )}
      </div>
    </div>
  );
});

export default KanbanColumn;

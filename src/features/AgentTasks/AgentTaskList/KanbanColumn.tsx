import { useDndContext, useDraggable, useDroppable } from '@dnd-kit/core';
import type { TaskStatus } from '@lobechat/types';
import { ActionIcon, type DropdownItem, DropdownMenu, Icon, Text } from '@lobehub/ui';
import { createStaticStyles, cx } from 'antd-style';
import { EyeOff, MoreHorizontal, Plus } from 'lucide-react';
import { memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import type { TaskListItem } from '@/store/task/slices/list/initialState';

import AgentTaskItem from '../features/AgentTaskItem';
import TaskStatusIcon from '../features/TaskStatusIcon';

export const COLUMN_WIDTH = 300;

const cardStyles = createStaticStyles(({ css, cssVar }) => ({
  card: css`
    border-radius: ${cssVar.borderRadiusLG};
    background: ${cssVar.colorBgElevated};
    box-shadow:
      0 1px 2px rgb(0 0 0 / 4%),
      0 2px 6px rgb(0 0 0 / 3%);

    &,
    & * {
      cursor: default;
    }

    &:active,
    &:active * {
      cursor: grabbing;
    }

    &:hover > * {
      background: ${cssVar.colorFillQuaternary};
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
      <AgentTaskItem task={task} variant="compact" />
    </div>
  );
});

const styles = createStaticStyles(({ css, cssVar }) => ({
  action: css`
    opacity: 0;
    transition: opacity 0.2s;
  `,
  addPill: css`
    cursor: pointer;

    display: flex;
    gap: 6px;
    align-items: center;
    justify-content: center;

    height: 36px;
    border: 1px solid ${cssVar.colorBorder};
    border-radius: 999px;

    color: ${cssVar.colorTextTertiary};

    transition:
      border-color 0.2s,
      color 0.2s,
      background 0.2s;

    &:hover {
      border-color: ${cssVar.colorPrimaryBorder};
      color: ${cssVar.colorPrimary};
      background: ${cssVar.colorBgContainer};
    }
  `,
  body: css`
    overflow-y: auto;
    display: flex;
    flex: 1;
    flex-direction: column;
    gap: 6px;

    padding-block: 4px 12px;
    padding-inline: 8px;
  `,
  column: css`
    display: flex;
    flex-direction: column;
    flex-shrink: 0;

    width: ${COLUMN_WIDTH}px;
    max-height: 100%;
    border-radius: ${cssVar.borderRadiusLG};

    background: ${cssVar.colorFillQuaternary};

    transition:
      background 0.2s,
      box-shadow 0.2s;

    &:hover .kanban-col-action {
      opacity: 1;
    }
  `,
  dropActive: css`
    background: ${cssVar.colorFillTertiary};
    box-shadow: inset 0 0 0 1px ${cssVar.colorPrimaryBorderHover};
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
    gap: 6px;
    align-items: center;

    padding-block: 10px 8px;
    padding-inline: 10px 6px;
  `,
  headerActions: css`
    display: flex;
    gap: 2px;
    align-items: center;
    margin-inline-start: auto;
  `,
  notDroppable: css`
    pointer-events: none;
    opacity: 0.4;
  `,
}));

export const COLUMN_I18N_KEYS: Record<string, string> = {
  backlog: 'taskList.kanban.backlog',
  canceled: 'taskList.kanban.canceled',
  done: 'taskList.kanban.done',
  needsInput: 'taskList.kanban.needsInput',
  running: 'taskList.kanban.running',
};

export const COLUMN_STATUS_ICON: Record<string, TaskStatus> = {
  backlog: 'backlog',
  canceled: 'canceled',
  done: 'completed',
  needsInput: 'paused',
  running: 'running',
};

interface KanbanColumnProps {
  columnKey: string;
  droppable: boolean;
  onCreate?: () => void;
  onHide?: () => void;
  tasks: TaskListItem[];
  total: number;
}

const KanbanColumn = memo<KanbanColumnProps>(
  ({ columnKey, droppable, onCreate, onHide, tasks, total }) => {
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
    const isFromThisColumn =
      activeTask && tasks.some((task) => task.identifier === activeTask.identifier);
    const showDropHighlight = isOver && droppable && !isFromThisColumn;
    const showDisabled = isDragActive && !droppable;

    const menuItems = useMemo<DropdownItem[]>(
      () =>
        onHide
          ? [
              {
                icon: <Icon icon={EyeOff} />,
                key: 'hide',
                label: t('taskList.kanban.hideColumn'),
                onClick: onHide,
              },
            ]
          : [],
      [onHide, t],
    );

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
          <div className={cx(styles.headerActions, 'kanban-col-action')}>
            {menuItems.length > 0 && (
              <DropdownMenu items={menuItems}>
                <ActionIcon icon={MoreHorizontal} size={'small'} />
              </DropdownMenu>
            )}
            {onCreate && (
              <ActionIcon
                icon={Plus}
                size={'small'}
                title={t('taskList.kanban.addTask')}
                onClick={onCreate}
              />
            )}
          </div>
        </div>
        <div className={styles.body}>
          {tasks.length > 0 ? (
            tasks.map((task) => <DraggableTaskCard key={task.identifier} task={task} />)
          ) : onCreate ? (
            <div className={styles.addPill} title={t('taskList.kanban.addTask')} onClick={onCreate}>
              <Icon icon={Plus} size={16} />
            </div>
          ) : (
            <div className={styles.emptyText}>{t('taskList.kanban.emptyColumn')}</div>
          )}
        </div>
      </div>
    );
  },
);

export default KanbanColumn;

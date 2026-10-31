import { useDndContext, useDraggable, useDroppable } from '@dnd-kit/core';
import type { TaskStatus } from '@lobechat/types';
import { type DropdownItem, DropdownMenu, Icon } from '@lobehub/ui';
import { ActionIcon, cx, Skeleton, Text } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { EyeOff, MoreHorizontal, Plus } from 'lucide-react';
import { memo, useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import type { TaskKanbanGroupBy, TaskListItem } from '@/store/task/slices/list/initialState';

import { createTaskModal } from '../CreateTaskModal';
import type { TaskItemRouteScope } from '../features/AgentTaskItem';
import AgentTaskItem from '../features/AgentTaskItem';
import TaskStatusIcon from '../features/TaskStatusIcon';
import {
  getKanbanColumnHeaderVariant,
  getKanbanCreateTaskModalProps,
  type KanbanColumnCreateDefaults,
} from './kanbanBoardModel';
import moduleStyles from './KanbanColumn.module.css';
import type { TaskGroupMeta } from './listViewOptions';
import TaskGroupLabel from './TaskGroupLabel';
import TaskItemSkeleton from './TaskItemSkeleton';

export const COLUMN_WIDTH = 300;

const DraggableTaskCard = memo<{ routeScope?: TaskItemRouteScope; task: TaskListItem }>(
  ({ routeScope, task }) => {
    const { attributes, isDragging, listeners, setNodeRef } = useDraggable({
      data: { task },
      id: task.identifier,
    });

    return (
      <div
        className={cx(moduleStyles.card, isDragging && moduleStyles.dragging)}
        ref={setNodeRef}
        {...listeners}
        {...attributes}
      >
        <AgentTaskItem routeScope={routeScope} task={task} variant="compact" />
      </div>
    );
  },
);

const styles = stylex.create({
  // The empty-column add pill stays hidden until the column is hovered, or
  // keyboard focus lands inside it.
  action: {
    opacity: { 'default': 0, [stylex.when.ancestor(':hover')]: 1, ':focus-within': 1 },
    transition: 'opacity 0.2s',
  },
  addPill: {
    cursor: 'pointer',
    display: 'flex',
    gap: '6px',
    alignItems: 'center',
    justifyContent: 'center',
    height: '36px',
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: { 'default': cssVar.colorBorder, ':hover': cssVar.colorPrimaryBorder },
    borderRadius: '999px',
    color: { 'default': cssVar.colorTextTertiary, ':hover': cssVar.colorPrimary },
    backgroundColor: { 'default': null, ':hover': cssVar.colorBgContainer },
    backgroundImage: { 'default': null, ':hover': 'none' },
    transition: 'border-color 0.2s, color 0.2s, background 0.2s',
  },
  body: {
    overflowY: 'auto',
    display: 'flex',
    flex: '1',
    flexDirection: 'column',
    gap: '6px',
    paddingBlockStart: '4px',
    paddingBlockEnd: '12px',
    paddingInline: '8px',
  },
  column: {
    display: 'flex',
    flexDirection: 'column',
    flexShrink: 0,
    width: `${COLUMN_WIDTH}px`,
    maxHeight: '100%',
    borderRadius: cssVar.borderRadiusLG,
    backgroundColor: cssVar.colorFillQuaternary,
    backgroundImage: 'none',
    transition: 'background 0.2s, box-shadow 0.2s',
  },
  dropActive: {
    backgroundColor: cssVar.colorFillTertiary,
    backgroundImage: 'none',
    boxShadow: `inset 0 0 0 1px ${cssVar.colorPrimaryBorderHover}`,
  },
  emptyText: {
    paddingBlock: '24px',
    paddingInline: '16px',
    fontSize: '13px',
    color: cssVar.colorTextQuaternary,
    textAlign: 'center',
  },
  header: {
    display: 'flex',
    gap: '6px',
    alignItems: 'center',
    paddingBlockStart: '10px',
    paddingBlockEnd: '8px',
    paddingInlineStart: '10px',
    paddingInlineEnd: '6px',
  },
  headerActions: {
    display: 'flex',
    gap: '2px',
    alignItems: 'center',
    marginInlineStart: 'auto',
  },
  notDroppable: { pointerEvents: 'none', opacity: 0.4 },
});

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
  /** Board scope agent, inherited by tasks created from this column. */
  agentId?: string;
  columnKey: string;
  /** Offers the in-column create entry, pinning these fields on the new task. */
  createDefaults?: KanbanColumnCreateDefaults;
  droppable: boolean;
  groupBy: TaskKanbanGroupBy;
  groupMeta?: TaskGroupMeta;
  loading?: boolean;
  onHide?: () => void;
  projectId?: string;
  routeScope?: TaskItemRouteScope;
  tasks: TaskListItem[];
  total: number;
}

const KanbanColumn = memo<KanbanColumnProps>(
  ({
    agentId,
    columnKey,
    createDefaults,
    droppable,
    groupBy,
    groupMeta,
    loading,
    onHide,
    projectId,
    routeScope,
    tasks,
    total,
  }) => {
    const { t } = useTranslation('chat');
    const { active } = useDndContext();
    const { isOver, setNodeRef } = useDroppable({
      disabled: !droppable,
      id: columnKey,
    });

    const statusIcon = COLUMN_STATUS_ICON[columnKey];
    const i18nKey = COLUMN_I18N_KEYS[columnKey];
    const label = i18nKey ? t(i18nKey as any) : t(`taskList.groupBy.${groupBy}` as any);
    const headerVariant = getKanbanColumnHeaderVariant({
      hasGroupMeta: !!groupMeta,
      loading,
    });
    const isDragActive = !!active;

    const canCreate = !!createDefaults;
    const openCreate = useCallback(() => {
      if (!createDefaults) return;
      createTaskModal(getKanbanCreateTaskModalProps(createDefaults, { agentId, projectId }));
    }, [agentId, createDefaults, projectId]);

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
        className={
          stylex.props(
            styles.column,
            stylex.defaultMarker(),
            showDropHighlight && styles.dropActive,
            showDisabled && styles.notDroppable,
          ).className
        }
      >
        <div className={stylex.props(styles.header).className}>
          {headerVariant === 'loading' ? (
            <>
              <Skeleton.Avatar
                shape={'square'}
                size={16}
                style={{ borderRadius: 4, flex: 'none' }}
              />
              <Skeleton height={14} style={{ minWidth: 64 }} width={64} />
              <Skeleton height={12} style={{ minWidth: 20 }} width={20} />
            </>
          ) : headerVariant === 'group' && groupMeta ? (
            <>
              <TaskGroupLabel group={groupMeta} />
              <Text fontSize={12} type={'secondary'}>
                {total}
              </Text>
            </>
          ) : (
            <>
              {statusIcon && <TaskStatusIcon size={18} status={statusIcon} />}
              <Text weight={500}>{label}</Text>
              <Text fontSize={12} type={'secondary'}>
                {total}
              </Text>
            </>
          )}
          <div className={stylex.props(styles.headerActions).className}>
            {menuItems.length > 0 && (
              <DropdownMenu items={menuItems}>
                <ActionIcon icon={MoreHorizontal} size={'small'} />
              </DropdownMenu>
            )}
            {canCreate && (
              <ActionIcon
                icon={Plus}
                size={'small'}
                title={t('taskList.kanban.addTask')}
                onClick={openCreate}
              />
            )}
          </div>
        </div>
        <div className={stylex.props(styles.body).className}>
          {loading ? (
            Array.from({ length: 3 }).map((_, index) => (
              <div className={moduleStyles.card} key={`kanban-skeleton-${columnKey}-${index}`}>
                <TaskItemSkeleton variant={'compact'} />
              </div>
            ))
          ) : tasks.length > 0 ? (
            tasks.map((task) => (
              <DraggableTaskCard key={task.identifier} routeScope={routeScope} task={task} />
            ))
          ) : canCreate ? (
            <div
              className={stylex.props(styles.addPill, styles.action).className}
              title={t('taskList.kanban.addTask')}
              onClick={openCreate}
            >
              <Icon icon={Plus} size={16} />
            </div>
          ) : (
            <div className={stylex.props(styles.emptyText).className}>
              {t('taskList.kanban.emptyColumn')}
            </div>
          )}
        </div>
      </div>
    );
  },
);

export default KanbanColumn;

import { useDraggable } from '@dnd-kit/core';
// oxlint-disable-next-line stylex-migration/no-emotion-styles -- cursor must reach every lobe-ui descendant of the card
import { createStaticStyles } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { memo } from 'react';

import type { TaskListItem } from '@/store/task/slices/list/initialState';
import { sx } from '@/styles/sx';

import type { TaskItemRouteScope } from '../features/AgentTaskItem';
import AgentTaskItem from '../features/AgentTaskItem';
import TaskItemSkeleton from './TaskItemSkeleton';

const styles = stylex.create({
  card: {
    cursor: { 'default': 'default', ':active': 'grabbing' },
    borderRadius: cssVar.borderRadiusLG,
    backgroundColor: cssVar.colorBgElevated,
    backgroundImage: 'none',
    boxShadow: '0 1px 2px rgb(0 0 0 / 4%), 0 2px 6px rgb(0 0 0 / 3%)',
  },
  dragging: {
    visibility: 'hidden',
  },
  surface: {
    backgroundColor: { 'default': null, ':hover': cssVar.colorFillQuaternary },
    backgroundImage: { 'default': null, ':hover': 'none' },
  },
});

const fallback = createStaticStyles(({ css }) => ({
  card: css`
    & * {
      cursor: default;
    }

    &:active * {
      cursor: grabbing;
    }
  `,
}));

export const DraggableTaskCard = memo<{ routeScope?: TaskItemRouteScope; task: TaskListItem }>(
  ({ routeScope, task }) => {
    const { attributes, isDragging, listeners, setNodeRef } = useDraggable({
      data: { task },
      id: task.identifier,
    });

    return (
      <div
        ref={setNodeRef}
        {...sx([styles.card, isDragging && styles.dragging], fallback.card)}
        {...listeners}
        {...attributes}
      >
        <AgentTaskItem
          className={stylex.props(styles.surface).className}
          routeScope={routeScope}
          task={task}
          variant="compact"
        />
      </div>
    );
  },
);

export const SkeletonTaskCard = () => (
  <div {...sx([styles.card], fallback.card)}>
    <TaskItemSkeleton className={stylex.props(styles.surface).className} variant={'compact'} />
  </div>
);

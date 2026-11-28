'use client';

import type { TaskDetailSubtask, TaskStatus } from '@lobechat/types';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { TASK_STATUS_VISUALS } from '@/components/ExecutionStatus';
import { sx } from '@/styles/sx';

/** Done first, then what needs a person, then what has not started. */
const STATUS_ORDER: TaskStatus[] = [
  'completed',
  'running',
  'paused',
  'failed',
  'scheduled',
  'backlog',
  'canceled',
];

const styles = stylex.create({
  bar: {
    borderRadius: 3,
    display: 'flex',
    gap: 2,
    height: 6,
    overflow: 'hidden',
  },
  dot: {
    borderRadius: '50%',
    flexShrink: 0,
    height: 6,
    width: 6,
  },
  legend: {
    color: cssVar.colorTextTertiary,
    columnGap: 12,
    display: 'flex',
    flexWrap: 'wrap',
    fontSize: 12,
    lineHeight: '20px',
    rowGap: 2,
  },
  legendItem: {
    alignItems: 'center',
    display: 'inline-flex',
    gap: 6,
    whiteSpace: 'nowrap',
  },
  root: {
    display: 'flex',
    flexDirection: 'column',
    gap: 6,
  },
});

/**
 * Where the subtasks stand at a glance: one bar split by status, nested
 * subtasks included, with a count per status underneath.
 */
const TaskSubtaskStatusBar = memo<{ subtasks: TaskDetailSubtask[] }>(({ subtasks }) => {
  const { t } = useTranslation('chat');

  const counts = useMemo(() => {
    const byStatus = new Map<TaskStatus, number>();
    const walk = (items: TaskDetailSubtask[]) => {
      for (const item of items) {
        const status = (
          STATUS_ORDER.includes(item.status as TaskStatus) ? item.status : 'backlog'
        ) as TaskStatus;
        byStatus.set(status, (byStatus.get(status) ?? 0) + 1);
        if (item.children?.length) walk(item.children);
      }
    };
    walk(subtasks);
    return STATUS_ORDER.filter((status) => byStatus.has(status)).map((status) => ({
      color: TASK_STATUS_VISUALS[status].color,
      count: byStatus.get(status)!,
      status,
    }));
  }, [subtasks]);

  const total = counts.reduce((sum, { count }) => sum + count, 0);
  // One subtask reads fine from its own row; a bar of one segment says nothing.
  if (total < 2) return null;

  return (
    <div {...stylex.props(styles.root)}>
      <div aria-hidden {...stylex.props(styles.bar)}>
        {counts.map(({ color, count, status }) => (
          <span key={status} style={{ backgroundColor: color, flexGrow: count }} />
        ))}
      </div>
      <div {...stylex.props(styles.legend)}>
        {counts.map(({ color, count, status }) => (
          <span key={status} {...stylex.props(styles.legendItem)}>
            <span {...sx(styles.dot, { backgroundColor: color })} />
            {t(`taskDetail.status.${status}` as never)} {count}
          </span>
        ))}
      </div>
    </div>
  );
});

TaskSubtaskStatusBar.displayName = 'TaskSubtaskStatusBar';

export default TaskSubtaskStatusBar;

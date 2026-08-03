'use client';

import { Flexbox, Icon, Text } from '@lobehub/ui';
import { createStaticStyles, cssVar } from 'antd-style';
import { PauseCircle } from 'lucide-react';
import { memo } from 'react';

import { useTaskStore } from '@/store/task';
import { taskDetailSelectors } from '@/store/task/selectors';

const styles = createStaticStyles(({ css }) => ({
  bar: css`
    padding-block: 8px;
    padding-inline: 12px;
    border-inline-start: 3px solid ${cssVar.colorWarning};
    border-start-end-radius: 6px;
    border-end-end-radius: 6px;

    background: ${cssVar.colorWarningBg};
  `,
}));

/**
 * Why a task stopped.
 *
 * `paused` is the only status the task vocabulary has for "stopped, needs a
 * human", so the badge alone cannot tell a delivery waiting for sign-off apart
 * from a goal that ran out of budget. The settle path writes that distinction
 * to `tasks.error`; this renders it next to the status instead of leaving the
 * explanation only in a Brief — the task activity feed deliberately excludes
 * briefs, so a brief-only reason is unreachable from this page.
 */
const TaskPauseReason = memo(() => {
  const status = useTaskStore(taskDetailSelectors.activeTaskStatus);
  const error = useTaskStore(taskDetailSelectors.activeTaskError);

  if (status !== 'paused' || !error) return null;

  return (
    <Flexbox horizontal align={'flex-start'} className={styles.bar} gap={8}>
      <Icon color={cssVar.colorWarning} icon={PauseCircle} size={14} style={{ marginTop: 2 }} />
      <Text fontSize={13}>{error}</Text>
    </Flexbox>
  );
});

TaskPauseReason.displayName = 'TaskPauseReason';

export default TaskPauseReason;

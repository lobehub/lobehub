import { createStaticStyles, cssVar, Flexbox, Text } from '@lobehub/ui';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

/** `3m` · `2.1h` · `1.4d` — the coarse grain a list row can carry. */
export const formatGoalDuration = (milliseconds: number) => {
  if (!milliseconds || milliseconds <= 0) return '—';
  const minutes = milliseconds / 60_000;
  if (minutes < 60) return `${Math.max(1, Math.round(minutes))}m`;
  const hours = minutes / 60;
  if (hours < 24) return `${hours.toFixed(1)}h`;
  return `${(hours / 24).toFixed(1)}d`;
};

export const formatGoalCost = (cost: number) => (cost > 0 ? `$${cost.toFixed(2)}` : '—');

const styles = createStaticStyles(({ css }) => ({
  acceptance: css`
    min-width: 0;
  `,
  metric: css`
    justify-self: end;
    white-space: nowrap;
  `,
  metrics: css`
    display: grid;
    grid-template-columns: minmax(0, 1fr) 48px 64px;
    column-gap: 12px;
    align-items: center;

    width: min(100%, 390px);
    min-width: 390px;

    /* On a phone the fixed width would crush the goal title beside it. The
       metrics take what is left on the row's second line (beside the agent
       and the menu), and the duration / cost cells shrink to their content. */
    @media (width <= 767px) {
      grid-template-columns: minmax(0, 1fr) auto auto;
      flex: 1 1 0;
      column-gap: 8px;

      width: auto;
      min-width: 0;
    }
  `,
  needsYou: css`
    flex: none;
    color: ${cssVar.colorWarning};
    white-space: nowrap;
  `,
  progress: css`
    overflow: hidden;
    flex: none;

    width: 64px;
    height: 4px;
    border-radius: ${cssVar.borderRadiusXS};

    background: ${cssVar.colorFillSecondary};
  `,
  progressValue: css`
    height: 100%;
    border-radius: inherit;
    background: ${cssVar.colorSuccess};
    transition: width 0.2s ${cssVar.motionEaseOut};
  `,
}));

export interface GoalProgressProps {
  pendingDecisions: number;
  taskDone: number;
  taskTotal: number;
  totalRunCost: number;
  totalRunDuration: number;
}

/**
 * The list row's roll-up: how far the graph got, whether anything is blocked
 * on the user right now, and how long it ran and what it cost.
 */
export const GoalProgress = memo<GoalProgressProps>(
  ({ pendingDecisions, totalRunCost, totalRunDuration, taskDone, taskTotal }) => {
    const { t } = useTranslation('chat');
    const progress = taskTotal > 0 ? Math.round((taskDone / taskTotal) * 100) : 0;

    return (
      <div className={styles.metrics}>
        {/* Progress and anything blocked on the user read as one cell, so
          duration and cost sit in fixed columns at the row's end and line up
          whether or not a goal needs you. */}
        <Flexbox horizontal align={'center'} className={styles.acceptance} gap={8}>
          {taskTotal > 0 ? (
            <Flexbox horizontal align={'center'} gap={6} style={{ minWidth: 0 }}>
              <div aria-hidden className={styles.progress}>
                <div className={styles.progressValue} style={{ width: `${progress}%` }} />
              </div>
              <Text ellipsis color={cssVar.colorTextTertiary} fontSize={12}>
                {t('goalList.taskProgress', { done: taskDone, total: taskTotal })}
              </Text>
            </Flexbox>
          ) : (
            <Text ellipsis color={cssVar.colorTextTertiary} fontSize={12}>
              {t('goalList.noTasks')}
            </Text>
          )}
          {pendingDecisions > 0 && (
            <Text className={styles.needsYou} fontSize={12}>
              {t('goalList.needsYou', { count: pendingDecisions })}
            </Text>
          )}
        </Flexbox>
        {/* A goal that has not run yet leaves these cells empty: a column of
          lone dashes reads as stray marks rather than as "nothing yet". */}
        <Text className={styles.metric} color={cssVar.colorTextTertiary} fontSize={12}>
          {totalRunDuration > 0 ? formatGoalDuration(totalRunDuration) : null}
        </Text>
        <Text className={styles.metric} color={cssVar.colorTextTertiary} fontSize={12}>
          {totalRunCost > 0 ? formatGoalCost(totalRunCost) : null}
        </Text>
      </div>
    );
  },
);

GoalProgress.displayName = 'GoalProgress';

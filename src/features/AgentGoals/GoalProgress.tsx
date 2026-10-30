import { Flexbox, Text } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
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

const styles = stylex.create({
  acceptance: { minWidth: '0' },
  metric: { justifySelf: 'end', whiteSpace: 'nowrap' },
  metrics: {
    display: 'grid',
    gridTemplateColumns: {
      'default': 'minmax(0, 1fr) 48px 64px',
      '@media (width <= 767px)': 'minmax(0, 1fr) auto auto',
    },
    flex: { 'default': null, '@media (width <= 767px)': '1 1 0' },
    columnGap: { 'default': '12px', '@media (width <= 767px)': '8px' },
    alignItems: 'center',
    width: { 'default': 'min(100%, 390px)', '@media (width <= 767px)': 'auto' },
    minWidth: { 'default': '390px', '@media (width <= 767px)': 0 },
  },
  needsYou: { flex: 'none', color: cssVar.colorWarning, whiteSpace: 'nowrap' },
  progress: {
    overflow: 'hidden',
    flex: 'none',
    width: '64px',
    height: '4px',
    borderRadius: cssVar.borderRadiusXS,
    backgroundColor: cssVar.colorFillSecondary,
    backgroundImage: 'none',
  },
  progressValue: {
    height: '100%',
    borderRadius: 'inherit',
    backgroundColor: cssVar.colorSuccess,
    backgroundImage: 'none',
    transition: `width 0.2s ${cssVar.motionEaseOut}`,
  },
});

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
      <div {...stylex.props(styles.metrics)}>
        {/* Progress and anything blocked on the user read as one cell, so
          duration and cost sit in fixed columns at the row's end and line up
          whether or not a goal needs you. */}
        <Flexbox
          horizontal
          align={'center'}
          className={stylex.props(styles.acceptance).className}
          gap={8}
        >
          {taskTotal > 0 ? (
            <Flexbox horizontal align={'center'} gap={6} style={{ minWidth: 0 }}>
              <div aria-hidden {...stylex.props(styles.progress)}>
                <div
                  className={stylex.props(styles.progressValue).className}
                  style={{ width: `${progress}%` }}
                />
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
            <Text className={stylex.props(styles.needsYou).className} fontSize={12}>
              {t('goalList.needsYou', { count: pendingDecisions })}
            </Text>
          )}
        </Flexbox>
        {/* A goal that has not run yet leaves these cells empty: a column of
          lone dashes reads as stray marks rather than as "nothing yet". */}
        <Text
          className={stylex.props(styles.metric).className}
          color={cssVar.colorTextTertiary}
          fontSize={12}
        >
          {totalRunDuration > 0 ? formatGoalDuration(totalRunDuration) : null}
        </Text>
        <Text
          className={stylex.props(styles.metric).className}
          color={cssVar.colorTextTertiary}
          fontSize={12}
        >
          {totalRunCost > 0 ? formatGoalCost(totalRunCost) : null}
        </Text>
      </div>
    );
  },
);

GoalProgress.displayName = 'GoalProgress';

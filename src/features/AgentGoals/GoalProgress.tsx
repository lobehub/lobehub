import { Flexbox } from '@lobehub/ui';
import { Text } from '@lobehub/ui/base-ui';
import { createStaticStyles, cssVar } from 'antd-style';
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
    grid-template-columns: minmax(178px, 1fr) 72px 48px 64px;
    column-gap: 12px;
    align-items: center;

    width: min(100%, 390px);
    min-width: 390px;
  `,
  needsYou: css`
    justify-self: end;
    color: ${cssVar.colorWarning};
    white-space: nowrap;
  `,
  progress: css`
    overflow: hidden;

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
  findingCount: number;
  pendingDecisions: number;
  totalRunCost: number;
  totalRunDuration: number;
  workDone: number;
  workTotal: number;
}

/**
 * The list row's roll-up: how far the graph got, what it produced, what it
 * cost — and, taking priority over the findings count, whether anything is
 * blocked on the user right now.
 */
export const GoalProgress = memo<GoalProgressProps>(
  ({ findingCount, pendingDecisions, totalRunCost, totalRunDuration, workDone, workTotal }) => {
    const { t } = useTranslation('chat');
    const progress = workTotal > 0 ? Math.round((workDone / workTotal) * 100) : 0;

    return (
      <div className={styles.metrics}>
        {workTotal > 0 ? (
          <Flexbox horizontal align={'center'} className={styles.acceptance} gap={6}>
            <div aria-hidden className={styles.progress}>
              <div className={styles.progressValue} style={{ width: `${progress}%` }} />
            </div>
            <Text ellipsis color={cssVar.colorTextTertiary} fontSize={12}>
              {t('goalList.workProgress', { done: workDone, total: workTotal })}
            </Text>
          </Flexbox>
        ) : (
          <Text ellipsis color={cssVar.colorTextTertiary} fontSize={12}>
            {t('goalList.noWork')}
          </Text>
        )}
        {pendingDecisions > 0 ? (
          <Text className={styles.needsYou} fontSize={12}>
            {t('goalList.needsYou', { count: pendingDecisions })}
          </Text>
        ) : (
          <Text className={styles.metric} color={cssVar.colorTextTertiary} fontSize={12}>
            {t('goalList.findings', { count: findingCount })}
          </Text>
        )}
        <Text className={styles.metric} color={cssVar.colorTextTertiary} fontSize={12}>
          {formatGoalDuration(totalRunDuration)}
        </Text>
        <Text className={styles.metric} color={cssVar.colorTextTertiary} fontSize={12}>
          {formatGoalCost(totalRunCost)}
        </Text>
      </div>
    );
  },
);

GoalProgress.displayName = 'GoalProgress';

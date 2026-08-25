import { Flexbox, Text } from '@lobehub/ui';
import { createStaticStyles, cssVar } from 'antd-style';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import type { getGoalPresentation } from './goalPresentation';
import { formatGoalCost, formatGoalDuration } from './goalViewModel';

const styles = createStaticStyles(({ css }) => ({
  acceptance: css`
    min-width: 0;
  `,
  loading: css`
    grid-column: 1 / -1;
  `,
  metric: css`
    justify-self: end;
    white-space: nowrap;
  `,
  metrics: css`
    display: grid;
    grid-template-columns: minmax(178px, 1fr) 64px 48px 64px;
    column-gap: 12px;
    align-items: center;

    width: min(100%, 390px);
    min-width: 390px;
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

interface GoalProgressProps {
  isLoading: boolean;
  presentation: ReturnType<typeof getGoalPresentation>;
  totalRunCost?: number | null;
  totalRunDuration?: number | null;
  totalRuns?: number | null;
}

export const GoalProgress = memo<GoalProgressProps>(
  ({ isLoading, presentation, totalRunCost = 0, totalRunDuration = 0, totalRuns = 0 }) => {
    const { t } = useTranslation('chat');

    if (isLoading)
      return (
        <div className={styles.metrics}>
          <Text className={styles.loading} fontSize={12} type={'secondary'}>
            {t('goalPage.loadingProgress')}
          </Text>
        </div>
      );

    return (
      <div className={styles.metrics}>
        {presentation.total > 0 ? (
          <Flexbox horizontal align={'center'} className={styles.acceptance} gap={6}>
            <div aria-hidden className={styles.progress}>
              <div
                className={styles.progressValue}
                style={{ width: `${presentation.progress}%` }}
              />
            </div>
            <Text ellipsis color={cssVar.colorTextTertiary} fontSize={12}>
              {t('goalList.acceptanceProgress', presentation)}
            </Text>
          </Flexbox>
        ) : (
          <Text ellipsis color={cssVar.colorTextTertiary} fontSize={12}>
            {t('goalList.roundProgress', {
              current: presentation.rounds,
              total: typeof presentation.maxRounds === 'number' ? presentation.maxRounds : '∞',
            })}
          </Text>
        )}
        <Text className={styles.metric} color={cssVar.colorTextTertiary} fontSize={12}>
          {t('goalList.agentRuns', { count: totalRuns })}
        </Text>
        <Text className={styles.metric} color={cssVar.colorTextTertiary} fontSize={12}>
          {formatGoalDuration(totalRunDuration ?? 0)}
        </Text>
        <Text className={styles.metric} color={cssVar.colorTextTertiary} fontSize={12}>
          {formatGoalCost(totalRunCost ?? 0)}
        </Text>
      </div>
    );
  },
);

GoalProgress.displayName = 'GoalProgress';

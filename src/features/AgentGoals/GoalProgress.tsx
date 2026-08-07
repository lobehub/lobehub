import { Flexbox, Text } from '@lobehub/ui';
import { createStaticStyles, cssVar } from 'antd-style';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import type { getGoalPresentation } from './goalPresentation';
import { formatGoalCost, formatGoalDuration } from './goalViewModel';

const styles = createStaticStyles(({ css }) => ({
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
        <Text fontSize={12} type={'secondary'}>
          {t('goalPage.loadingProgress')}
        </Text>
      );

    return (
      <Flexbox horizontal align={'center'} gap={14} style={{ flexShrink: 0 }}>
        {presentation.total > 0 ? (
          <Flexbox horizontal align={'center'} gap={6}>
            <div aria-hidden className={styles.progress}>
              <div
                className={styles.progressValue}
                style={{ width: `${presentation.progress}%` }}
              />
            </div>
            <Text color={cssVar.colorTextTertiary} fontSize={12}>
              {t('goalList.acceptanceProgress', presentation)}
            </Text>
          </Flexbox>
        ) : (
          <Text color={cssVar.colorTextTertiary} fontSize={12}>
            {t('goalList.roundProgress', {
              current: presentation.rounds,
              total: typeof presentation.maxRounds === 'number' ? presentation.maxRounds : '∞',
            })}
          </Text>
        )}
        <Text color={cssVar.colorTextTertiary} fontSize={12}>
          {t('goalList.agentRuns', { count: totalRuns })}
        </Text>
        <Text color={cssVar.colorTextTertiary} fontSize={12}>
          {formatGoalDuration(totalRunDuration ?? 0)}
        </Text>
        <Text color={cssVar.colorTextTertiary} fontSize={12}>
          {formatGoalCost(totalRunCost ?? 0)}
        </Text>
      </Flexbox>
    );
  },
);

GoalProgress.displayName = 'GoalProgress';

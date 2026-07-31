'use client';

import { Flexbox, Text } from '@lobehub/ui';
import { createStaticStyles, cssVar } from 'antd-style';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

interface GoalRound {
  report: { verdict?: string | null } | null;
  run: { createdAt: Date | string; roundIndex?: number | null; status?: string | null };
}

const styles = createStaticStyles(({ css }) => ({
  dot: css`
    position: absolute;
    inset-block-end: -2px;
    inset-inline-end: -2px;

    width: 7px;
    height: 7px;
    border: 2px solid ${cssVar.colorBgContainer};
    border-radius: 50%;

    background: ${cssVar.colorError};
  `,
  rail: css`
    display: flex;
    gap: 5px;
    min-width: 0;
    height: 11px;
  `,
  round: css`
    position: relative;
    min-width: 18px;
    border-radius: 4px;
    background: ${cssVar.colorInfoBgHover};

    &[data-active='true'] {
      background: ${cssVar.colorInfo};
    }
  `,
}));

export const formatGoalDuration = (milliseconds: number) => {
  const hours = milliseconds / 3_600_000;
  if (hours < 24) return `${Math.max(1, Math.round(hours))}h`;
  return `${Number((hours / 24).toFixed(1))}d`;
};

const GoalRoundTimeline = memo<{ rounds?: GoalRound[] }>(({ rounds = [] }) => {
  const { t } = useTranslation('chat');
  if (rounds.length === 0) return null;

  const start = new Date(rounds[0].run.createdAt).getTime();
  const elapsed = Math.max(1, Date.now() - start);

  return (
    <Flexbox gap={8}>
      <Flexbox horizontal align={'center'} justify={'space-between'}>
        <Text fontSize={12} type={'secondary'}>
          {t('taskDetail.goalTimeline.title')}
        </Text>
        <Text fontSize={12} type={'secondary'}>
          {t('taskDetail.goalTimeline.rounds', { count: rounds.length })} ·{' '}
          {formatGoalDuration(elapsed)}
        </Text>
      </Flexbox>
      <div className={styles.rail}>
        {rounds.map(({ report, run }, index) => (
          <div
            className={styles.round}
            data-active={run.status === 'running' || index === rounds.length - 1}
            key={`${run.roundIndex ?? index}-${new Date(run.createdAt).getTime()}`}
            style={{ flex: index + 1 }}
            title={t('taskDetail.goalTimeline.round', { index: run.roundIndex ?? index + 1 })}
          >
            {report?.verdict === 'fail' && <span className={styles.dot} />}
          </div>
        ))}
      </div>
    </Flexbox>
  );
});

GoalRoundTimeline.displayName = 'GoalRoundTimeline';

export default GoalRoundTimeline;

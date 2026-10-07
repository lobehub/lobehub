'use client';

import { type EvalReplayTargetMetrics } from '@lobechat/types';
import { Flexbox } from '@lobehub/ui';
import { cssVar } from 'antd-style';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import ModelLabel from '@/features/Eval/components/ModelLabel';

import { styles } from './style';

const percent = (v: number) => `${Math.round(v * 100)}%`;

/**
 * One tile per model, best first: how often it passed, its mean score and how
 * many cells failed to run.
 */
const TargetSummary = memo<{ summaries: EvalReplayTargetMetrics[] }>(({ summaries }) => {
  const { t } = useTranslation('eval');

  return (
    <div
      style={{
        display: 'grid',
        gap: 12,
        gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))',
      }}
    >
      {summaries.map((s) => (
        <Flexbox
          className={styles.card}
          data-testid="comparison-target-summary"
          gap={8}
          key={`${s.provider}/${s.model}`}
          padding={16}
        >
          <ModelLabel model={s.model} provider={s.provider} />
          <Flexbox horizontal align="baseline" gap={8}>
            <span
              className={styles.stat}
              style={{
                color: s.passedCases > 0 ? cssVar.colorSuccess : cssVar.colorTextSecondary,
              }}
            >
              {percent(s.passRate)}
            </span>
            <span className={styles.configLabel}>
              {t('comparison.summary.passed', { passed: s.passedCases, total: s.totalCases })}
            </span>
          </Flexbox>
          <Flexbox horizontal className={styles.configLabel} gap={12}>
            <span>{t('comparison.summary.avgScore', { score: s.averageScore.toFixed(2) })}</span>
            {s.errorCases > 0 && (
              <span style={{ color: cssVar.colorWarning }}>
                {t('comparison.summary.errors', { count: s.errorCases })}
              </span>
            )}
          </Flexbox>
        </Flexbox>
      ))}
    </div>
  );
});

TargetSummary.displayName = 'EvalComparisonTargetSummary';

export default TargetSummary;

'use client';

import type { EvalRunMetrics } from '@lobechat/types';
import { formatCost, formatShortenNumber } from '@lobechat/utils';
import { useTranslation } from 'react-i18next';

import { StatGrid, StatTile } from '@/features/Eval/components/StatTile';
import { formatDuration } from '@/features/Eval/utils';

const has = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

interface RunStatsProps {
  k?: number;
  metrics?: EvalRunMetrics | null;
}

/** The run's outcome in one row: pass rate first, then where the rest went, then what it cost. */
const RunStats = ({ k = 1, metrics }: RunStatsProps) => {
  const { t } = useTranslation('eval');
  const total = metrics?.totalCases ?? 0;
  const passed = metrics?.passedCases ?? 0;
  const failed = metrics?.failedCases ?? 0;
  const errored = (metrics?.errorCases ?? 0) + (metrics?.timeoutCases ?? 0);
  const perCase = t('run.metrics.perCase');

  return (
    <StatGrid>
      <StatTile
        hint={total > 0 ? t('run.stats.passedOf', { passed, total }) : undefined}
        label={t('run.metrics.passRate')}
        value={has(metrics?.passRate) ? `${Math.round(metrics.passRate * 100)}%` : '–'}
      />
      <StatTile
        label={t('table.filter.passed')}
        tone={passed ? 'success' : undefined}
        value={passed}
      />
      <StatTile
        label={t('table.filter.failed')}
        tone={failed ? 'error' : undefined}
        value={failed}
      />
      <StatTile
        label={t('table.filter.error')}
        tone={errored ? 'warning' : undefined}
        value={errored}
      />
      {k > 1 && has(metrics?.passAtK) && (
        <StatTile
          label={`pass@${k}`}
          value={`${Math.round(metrics.passAtK * 100)}%`}
          hint={
            has(metrics?.passAllK) ? `pass^${k} ${Math.round(metrics.passAllK * 100)}%` : undefined
          }
        />
      )}
      {has(metrics?.averageScore) && passed + failed > 0 && (
        <StatTile label={t('run.metrics.avgScore')} value={metrics.averageScore.toFixed(2)} />
      )}
      <StatTile
        label={t('run.metrics.duration')}
        value={has(metrics?.duration) ? formatDuration(metrics.duration) : '–'}
        hint={
          has(metrics?.totalDuration) && total > 0
            ? `~${formatDuration(metrics.totalDuration / total)} ${perCase}`
            : undefined
        }
      />
      {has(metrics?.totalTokens) && (
        <StatTile
          label={t('run.metrics.tokens')}
          value={formatShortenNumber(metrics.totalTokens)}
          hint={
            has(metrics?.perCaseTokens)
              ? `~${formatShortenNumber(Math.round(metrics.perCaseTokens))} ${perCase}`
              : undefined
          }
        />
      )}
      {has(metrics?.totalCost) && (
        <StatTile
          label={t('run.metrics.cost')}
          value={`$${formatCost(metrics.totalCost)}`}
          hint={
            has(metrics?.perCaseCost)
              ? `~$${formatCost(metrics.perCaseCost)} ${perCase}`
              : undefined
          }
        />
      )}
    </StatGrid>
  );
};

export default RunStats;

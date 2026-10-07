'use client';

import type { AgentEvalRunListItem } from '@lobechat/types';
import { useTranslation } from 'react-i18next';

import AsyncError from '@/components/AsyncError';
import { StatGrid, StatTile } from '@/features/Eval/components/StatTile';

import { getRecentPassRate } from './runHelpers';

interface OverviewProps {
  benchmarkCount: number;
  datasetCount?: number;
  datasetsError?: unknown;
  onRetryDatasets: () => void;
  runs: AgentEvalRunListItem[];
  testCaseCount?: number;
}

const passTone = (rate: number) => (rate >= 0.8 ? 'success' : rate >= 0.5 ? 'warning' : 'error');

/** The state of the user's evals at a glance — every figure links to a section below. */
const Overview = ({
  benchmarkCount,
  datasetCount,
  datasetsError,
  onRetryDatasets,
  runs,
  testCaseCount,
}: OverviewProps) => {
  const { t } = useTranslation('eval');
  const recent = getRecentPassRate(runs);

  // A failed dataset fetch must not read as a confident 0.
  const datasetValue = (value: number | undefined) =>
    datasetsError && value === undefined ? (
      <AsyncError error={datasetsError} variant="metric" onRetry={onRetryDatasets} />
    ) : (
      (value ?? '—')
    );

  return (
    <StatGrid>
      <StatTile label={t('home.stats.benchmarks')} value={benchmarkCount} />
      <StatTile label={t('home.stats.datasets')} value={datasetValue(datasetCount)} />
      <StatTile label={t('home.stats.testCases')} value={datasetValue(testCaseCount)} />
      {recent && (
        <StatTile
          hint={t('home.stats.passRateHint', { count: recent.runCount })}
          label={t('home.stats.passRate')}
          tone={passTone(recent.rate)}
          value={`${Math.round(recent.rate * 100)}%`}
        />
      )}
    </StatGrid>
  );
};

export default Overview;

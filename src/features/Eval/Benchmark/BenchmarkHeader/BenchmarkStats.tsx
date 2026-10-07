'use client';

import type { AgentEvalRunListItem } from '@lobechat/types';
import { formatCost } from '@lobechat/utils';
import { useTranslation } from 'react-i18next';

import { StatGrid, StatTile } from '@/features/Eval/components/StatTile';
import { formatDuration } from '@/features/Eval/utils';

import { getRunPassRate } from '../RunsTab/groupRuns';
import { getRunModel } from '../RunsTab/runModel';

interface BenchmarkStatsProps {
  caseCount: number;
  datasetCount: number;
  runs: AgentEvalRunListItem[];
}

const average = (values: number[]) =>
  values.length > 0 ? values.reduce((a, b) => a + b, 0) / values.length : undefined;

/** The benchmark at a glance: its best result, its size, and what a run costs. */
const BenchmarkStats = ({ caseCount, datasetCount, runs }: BenchmarkStatsProps) => {
  const { t } = useTranslation('eval');
  const completed = runs.filter((r) => r.status === 'completed');

  let best: AgentEvalRunListItem | undefined;
  let bestRate: number | undefined;
  for (const run of completed) {
    const rate = getRunPassRate(run);
    if (rate !== undefined && (bestRate === undefined || rate > bestRate)) {
      best = run;
      bestRate = rate;
    }
  }
  const bestModel = best && getRunModel(best);

  const avgDuration = average(
    completed
      .map((r) => r.metrics?.duration ?? r.totalDuration)
      .filter((d): d is number => !!d && d > 0),
  );
  const avgCost = average(
    completed
      .map((r) => r.metrics?.totalCost ?? r.totalCost)
      .filter((c): c is number => !!c && c > 0),
  );

  return (
    <StatGrid>
      <StatTile
        label={t('benchmark.card.bestPassRate')}
        value={bestRate === undefined ? '—' : `${Math.round(bestRate * 100)}%`}
        hint={
          best
            ? [bestModel?.model, best.targetAgent?.title].filter(Boolean).join(' · ')
            : t('benchmark.detail.stats.noEvalRecord')
        }
      />
      <StatTile
        hint={t('benchmark.card.datasetCount', { count: datasetCount })}
        label={t('benchmark.detail.stats.totalCases')}
        value={caseCount}
      />
      <StatTile
        label={t('benchmark.detail.stats.avgDuration')}
        value={avgDuration === undefined ? '—' : formatDuration(avgDuration)}
        hint={
          avgDuration === undefined
            ? undefined
            : t('benchmark.detail.stats.basedOnLastNRuns', { count: completed.length })
        }
      />
      <StatTile
        hint={avgCost === undefined ? undefined : t('benchmark.detail.stats.perRun')}
        label={t('benchmark.detail.stats.avgCost')}
        value={avgCost === undefined ? '—' : `$${formatCost(avgCost)}`}
      />
    </StatGrid>
  );
};

export default BenchmarkStats;

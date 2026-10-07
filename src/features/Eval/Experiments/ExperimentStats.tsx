'use client';

import type { AgentEvalExperimentDetail } from '@lobechat/types';
import { useTranslation } from 'react-i18next';

import { StatGrid, StatTile } from '@/features/Eval/components/StatTile';

interface ExperimentStatsProps {
  datasetCount: number;
  experiment: AgentEvalExperimentDetail;
}

const ExperimentStats = ({ experiment, datasetCount }: ExperimentStatsProps) => {
  const { t } = useTranslation('eval');

  return (
    <StatGrid>
      <StatTile
        label={t('experiment.detail.stats.benchmarks')}
        value={experiment.benchmarks.length}
      />
      <StatTile label={t('sidebar.datasets')} value={datasetCount} />
      <StatTile label={t('experiment.detail.stats.runs')} value={experiment.runs.length} />
    </StatGrid>
  );
};

export default ExperimentStats;

'use client';

import { ActionIcon, Empty, Flexbox } from '@lobehub/ui';
import { Typography } from 'antd';
import { Play, Plus } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { runSelectors, useEvalStore } from '@/store/eval';

import RunSummaryCard from './RunSummaryCard';

interface RunCardsProps {
  benchmarkId: string;
  datasetId?: string;
  onCreateRun: () => void;
}

const RunCards = memo<RunCardsProps>(({ datasetId, onCreateRun, benchmarkId }) => {
  const { t } = useTranslation('eval');
  const useFetchDatasetRuns = useEvalStore((s) => s.useFetchDatasetRuns);
  const runList = useEvalStore(runSelectors.datasetRunList(datasetId!));
  useFetchDatasetRuns(datasetId);

  return (
    <Flexbox gap={12}>
      <Flexbox horizontal align="center" justify="space-between">
        <Typography.Text strong>{t('benchmark.detail.tabs.runs')}</Typography.Text>
        <ActionIcon
          icon={Plus}
          size="small"
          title={t('run.actions.create')}
          onClick={onCreateRun}
        />
      </Flexbox>
      {runList.length === 0 ? (
        <Empty description={t('benchmark.card.empty')} icon={Play} />
      ) : (
        <Flexbox gap={8}>
          {runList.map((run) => (
            <RunSummaryCard
              benchmarkId={benchmarkId}
              id={run.id}
              key={run.id}
              metrics={run.metrics ?? undefined}
              name={run.name ?? undefined}
              status={run.status}
            />
          ))}
        </Flexbox>
      )}
    </Flexbox>
  );
});

export default RunCards;

'use client';

import { Flexbox } from '@lobehub/ui';
import { memo } from 'react';
import { useParams } from 'react-router';

import AsyncError from '@/components/AsyncError';
import EvalPage from '@/features/Eval/components/EvalPage';
import { experimentSelectors, useEvalStore } from '@/store/eval';

import BenchmarksSection from './BenchmarksSection';
import ExperimentHeader from './ExperimentHeader';
import ExperimentSkeleton from './ExperimentSkeleton';
import ExperimentStats from './ExperimentStats';
import RunsSection from './RunsSection';
import ScopedDatasetsSection from './ScopedDatasetsSection';
import { useExperimentActions } from './useExperimentActions';

/**
 * Experiment workspace page. Thin orchestrator: one fetch populates the single
 * experiment-detail payload (benchmarks + datasets + runs); every section is a
 * focused component fed by the shared useExperimentActions.
 */
const ExperimentDetailPage = memo(() => {
  const { experimentId } = useParams<{ experimentId: string }>();
  const useFetchExperimentDetail = useEvalStore((s) => s.useFetchExperimentDetail);
  const experiment = useEvalStore(experimentSelectors.getExperimentDetailById(experimentId || ''));

  const { error, isLoading, mutate } = useFetchExperimentDetail(experimentId);

  const actions = useExperimentActions(experiment);

  if (!experiment) {
    if (isLoading || !error) return <ExperimentSkeleton />;
    return <AsyncError error={error} variant={'page'} onRetry={() => void mutate()} />;
  }

  return (
    <Flexbox flex={1} style={{ minHeight: 0, overflowY: 'auto' }} width="100%">
      <EvalPage header={<ExperimentHeader experiment={experiment} />}>
        <ExperimentStats datasetCount={experiment.datasets.length} experiment={experiment} />
        <BenchmarksSection actions={actions} experiment={experiment} />
        <ScopedDatasetsSection actions={actions} />
        <RunsSection actions={actions} experiment={experiment} />
      </EvalPage>
    </Flexbox>
  );
});

export default ExperimentDetailPage;

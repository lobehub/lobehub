'use client';

import { Flexbox, Skeleton } from '@lobehub/ui';
import { createStaticStyles } from 'antd-style';
import { memo } from 'react';
import { useParams } from 'react-router';

import AsyncBoundary from '@/components/AsyncBoundary';
import { experimentSelectors, useEvalStore } from '@/store/eval';

import BenchmarksSection from './BenchmarksSection';
import ExperimentHeader from './ExperimentHeader';
import ExperimentStats from './ExperimentStats';
import RunsSection from './RunsSection';
import ScopedDatasetsSection from './ScopedDatasetsSection';
import { useExperimentActions } from './useExperimentActions';

const styles = createStaticStyles(({ css }) => ({
  container: css`
    overflow-y: auto;
    padding-block: 24px;
    padding-inline: 32px;
  `,
}));

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

  // Error (including a deleted / unknown experiment) must gate before the
  // skeleton — otherwise a failed first load hangs on it forever (ux Feedback).
  return (
    <Flexbox className={styles.container} gap={24} height="100%" width="100%">
      <AsyncBoundary
        data={experiment}
        error={error}
        errorVariant={'block'}
        isLoading={isLoading && !experiment}
        loading={
          <>
            <Skeleton active paragraph={{ rows: 2 }} title={{ width: 240 }} />
            <Skeleton active paragraph={{ rows: 6 }} title={false} />
          </>
        }
        onRetry={() => mutate()}
      >
        {experiment && (
          <>
            <ExperimentHeader experiment={experiment} />
            <ExperimentStats datasetCount={experiment.datasets.length} experiment={experiment} />
            <BenchmarksSection actions={actions} experiment={experiment} />
            <ScopedDatasetsSection actions={actions} />
            <RunsSection actions={actions} experiment={experiment} />
          </>
        )}
      </AsyncBoundary>
    </Flexbox>
  );
});

export default ExperimentDetailPage;

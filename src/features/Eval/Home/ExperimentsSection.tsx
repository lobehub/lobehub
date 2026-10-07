'use client';

import { Button } from '@lobehub/ui/base-ui';
import { Beaker, Plus } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import AsyncBoundary from '@/components/AsyncBoundary';
import EvalEmpty from '@/features/Eval/components/EvalEmpty';
import EvalSection from '@/features/Eval/components/EvalSection';
import { createExperimentModal, ExperimentSummaryCard } from '@/features/Eval/Experiments';
import { useEvalStore } from '@/store/eval';

import { BenchmarkGridSkeleton, gridStyles } from './BenchmarkGrid';

/** Experiments group several benchmarks; secondary to the benchmark flow, so default buttons only. */
const ExperimentsSection = () => {
  const { t } = useTranslation('eval');
  const experimentList = useEvalStore((s) => s.experimentList);
  const useFetchExperiments = useEvalStore((s) => s.useFetchExperiments);
  const { data, error, isLoading, mutate } = useFetchExperiments();
  const hasExperiments = experimentList.length > 0;

  return (
    <EvalSection
      count={hasExperiments ? experimentList.length : undefined}
      description={t('overview.sections.experiments.subtitle')}
      title={t('overview.sections.experiments.title')}
      actions={
        hasExperiments && (
          <Button icon={Plus} size="small" onClick={() => createExperimentModal()}>
            {t('overview.createExperiment')}
          </Button>
        )
      }
    >
      <AsyncBoundary
        data={data}
        error={error}
        isEmpty={!hasExperiments}
        isLoading={isLoading}
        loading={<BenchmarkGridSkeleton count={2} />}
        empty={
          <EvalEmpty
            compact
            description={t('home.experiments.emptyHint')}
            icon={Beaker}
            title={t('experiment.empty')}
            action={
              <Button icon={Plus} size="small" onClick={() => createExperimentModal()}>
                {t('overview.createExperiment')}
              </Button>
            }
          />
        }
        onRetry={() => mutate()}
      >
        <div className={gridStyles.grid}>
          {experimentList.map((experiment) => (
            <ExperimentSummaryCard experiment={experiment} key={experiment.id} />
          ))}
        </div>
      </AsyncBoundary>
    </EvalSection>
  );
};

export default ExperimentsSection;

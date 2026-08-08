'use client';

import { Empty, Flexbox, Skeleton, Text } from '@lobehub/ui';
import { Button } from '@lobehub/ui/base-ui';
import { createStaticStyles, cssVar } from 'antd-style';
import { FlaskConical, Plus } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import AsyncBoundary from '@/components/AsyncBoundary';
import { useEvalStore } from '@/store/eval';

import BenchmarkCard from './features/BenchmarkCard';
import { createCreateBenchmarkModal } from './features/CreateBenchmarkModal';
import { createExperimentModal, ExperimentSummaryCard } from './features/Experiments';

const styles = createStaticStyles(({ css }) => ({
  container: css`
    overflow-y: auto;
    padding-block: 24px;
    padding-inline: 32px;
  `,
  grid: css`
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(480px, 1fr));
    gap: 20px;
  `,
  skeletonCard: css`
    padding: 20px;
    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: ${cssVar.borderRadiusLG};
    background: ${cssVar.colorBgContainer};
  `,
  title: css`
    margin: 0;
    line-height: 1.3;
  `,
}));

// Loading placeholder that reuses the benchmark-card chrome so loading → loaded
// is a content swap, not a relayout (ux §4.1).
const SkeletonGrid = memo(() => (
  <div className={styles.grid}>
    {[0, 1, 2, 3].map((i) => (
      <Flexbox className={styles.skeletonCard} gap={16} key={i}>
        <Flexbox horizontal gap={12}>
          <Skeleton.Avatar active shape={'square'} size={36} />
          <Flexbox flex={1} gap={8}>
            <Skeleton.Button active size={'small'} style={{ height: 14, width: 160 }} />
            <Skeleton.Button active size={'small'} style={{ height: 12, width: 220 }} />
          </Flexbox>
        </Flexbox>
        <Skeleton.Button active block size={'small'} style={{ height: 64 }} />
      </Flexbox>
    ))}
  </div>
));

const EvalOverview = memo(() => {
  const { t } = useTranslation('eval');
  const benchmarkList = useEvalStore((s) => s.benchmarkList);
  const useFetchBenchmarks = useEvalStore((s) => s.useFetchBenchmarks);
  const { data, isLoading, error, mutate } = useFetchBenchmarks();

  const experimentList = useEvalStore((s) => s.experimentList);
  const useFetchExperiments = useEvalStore((s) => s.useFetchExperiments);
  const {
    data: experimentData,
    isLoading: isLoadingExperiments,
    error: experimentError,
    mutate: mutateExperiments,
  } = useFetchExperiments();

  // Purpose-built onboarding empty — only reached when the fetch succeeded with
  // zero benchmarks. A *failed* fetch is gated ahead of this by AsyncBoundary so
  // we never invite the user to re-create benchmarks they already own (ux Read
  // §1.1 error-as-empty trap).
  const emptyState = (
    <Flexbox align={'center'} flex={1} justify={'center'}>
      <Empty description={t('benchmark.empty')} icon={FlaskConical}>
        <Button
          icon={Plus}
          style={{ marginTop: 16 }}
          type={'primary'}
          onClick={() => createCreateBenchmarkModal()}
        >
          {t('overview.createBenchmark')}
        </Button>
      </Empty>
    </Flexbox>
  );

  // Same contract for the experiments grid (ux Read: empty is a real page with
  // a CTA, not a blank grid).
  const experimentsEmptyState = (
    <Flexbox align={'center'} flex={1} justify={'center'}>
      <Empty description={t('experiment.empty')} icon={FlaskConical}>
        <Button
          icon={Plus}
          style={{ marginTop: 16 }}
          type={'primary'}
          onClick={() => createExperimentModal()}
        >
          {t('overview.createExperiment')}
        </Button>
      </Empty>
    </Flexbox>
  );

  return (
    <Flexbox className={styles.container} gap={32} height={'100%'} width={'100%'}>
      {/* Header */}
      <Flexbox horizontal align={'center'} gap={16} justify={'space-between'}>
        <Flexbox gap={4} style={{ minWidth: 0 }}>
          <Text ellipsis as={'h1'} className={styles.title} fontSize={30} weight={600}>
            {t('overview.title')}
          </Text>
          <Text type={'secondary'}>{t('overview.subtitle')}</Text>
        </Flexbox>
        {benchmarkList.length > 0 && (
          <Button icon={Plus} type={'primary'} onClick={() => createCreateBenchmarkModal()}>
            {t('overview.createBenchmark')}
          </Button>
        )}
      </Flexbox>

      {/* Experiments */}
      <Flexbox gap={16}>
        <Flexbox horizontal align={'center'} justify={'space-between'}>
          <Text as={'h2'} style={{ fontSize: 18, fontWeight: 600, margin: 0 }}>
            {t('overview.sections.experiments.title')}
          </Text>
          <Button icon={Plus} size={'small'} onClick={() => createExperimentModal()}>
            {t('overview.createExperiment')}
          </Button>
        </Flexbox>
        <AsyncBoundary
          data={experimentData}
          empty={experimentsEmptyState}
          error={experimentError}
          errorVariant={'block'}
          isEmpty={experimentList.length === 0}
          isLoading={isLoadingExperiments}
          loading={<SkeletonGrid />}
          onRetry={() => mutateExperiments()}
        >
          <div className={styles.grid}>
            {experimentList.map((experiment) => (
              <ExperimentSummaryCard experiment={experiment} key={experiment.id} />
            ))}
          </div>
        </AsyncBoundary>
      </Flexbox>

      {/* Benchmarks */}
      <Flexbox gap={16}>
        <Text as={'h2'} style={{ fontSize: 18, fontWeight: 600, margin: 0 }}>
          {t('overview.sections.benchmarks.title')}
        </Text>
        {/* Body: error / loading / empty / grid (error gated before empty) */}
        <AsyncBoundary
          data={data}
          empty={emptyState}
          error={error}
          errorVariant={'block'}
          isEmpty={benchmarkList.length === 0}
          isLoading={isLoading}
          loading={<SkeletonGrid />}
          onRetry={() => mutate()}
        >
          <div className={styles.grid}>
            {benchmarkList.map((benchmark: any) => (
              <BenchmarkCard
                bestScore={benchmark.bestScore}
                datasetCount={benchmark.datasetCount}
                description={benchmark.description}
                id={benchmark.id}
                key={benchmark.id}
                name={benchmark.name}
                recentRuns={benchmark.recentRuns}
                runCount={benchmark.runCount}
                source={benchmark.source}
                tags={benchmark.tags}
                testCaseCount={benchmark.testCaseCount}
              />
            ))}
          </div>
        </AsyncBoundary>
      </Flexbox>
    </Flexbox>
  );
});

export default EvalOverview;

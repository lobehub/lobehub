'use client';

import { Flexbox } from '@lobehub/ui';
import { Button, Skeleton } from '@lobehub/ui/base-ui';
import { createStaticStyles } from 'antd-style';
import { FlaskConical, Plus } from 'lucide-react';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import AsyncBoundary from '@/components/AsyncBoundary';
import EvalEmpty from '@/features/Eval/components/EvalEmpty';
import EvalPage, { EvalPageHeader } from '@/features/Eval/components/EvalPage';
import EvalSection from '@/features/Eval/components/EvalSection';
import { StatGrid } from '@/features/Eval/components/StatTile';
import { createCreateBenchmarkModal } from '@/features/Eval/CreateBenchmarkModal';
import { useEvalStore } from '@/store/eval';

import BenchmarkGrid, { BenchmarkGridSkeleton } from './BenchmarkGrid';
import ExperimentsSection from './ExperimentsSection';
import Overview from './Overview';
import RecentRuns from './RecentRuns';
import { useRecentRuns } from './useRecentRuns';

const styles = createStaticStyles(({ css }) => ({
  scroller: css`
    overflow-y: auto;
    width: 100%;
    height: 100%;
  `,
}));

interface DatasetListItem {
  benchmarkId?: string | null;
  id: string;
  testCaseCount?: number | string;
}

/** Page-shaped placeholder while the benchmark list (the page's anchor) loads. */
const HomeSkeleton = () => (
  <>
    <StatGrid>
      {[0, 1, 2, 3].map((i) => (
        <Skeleton height={72} key={i} />
      ))}
    </StatGrid>
    <Flexbox gap={12}>
      <Skeleton height={18} width={160} />
      <Skeleton height={168} />
    </Flexbox>
    <Flexbox gap={12}>
      <Skeleton height={18} width={120} />
      <BenchmarkGridSkeleton />
    </Flexbox>
  </>
);

const createBenchmark = () => createCreateBenchmarkModal();

const EvalHome = () => {
  const { t } = useTranslation('eval');

  const benchmarkList = useEvalStore((s) => s.benchmarkList);
  const useFetchBenchmarks = useEvalStore((s) => s.useFetchBenchmarks);
  const useFetchAllDatasets = useEvalStore((s) => s.useFetchAllDatasets);
  const benchmarks = useFetchBenchmarks();
  const datasets = useFetchAllDatasets();
  const recent = useRecentRuns();

  const datasetList = datasets.data as DatasetListItem[] | undefined;

  const benchmarkIdByDataset = useMemo(
    () => new Map((datasetList ?? []).map((d) => [d.id, d.benchmarkId])),
    [datasetList],
  );

  const testCaseCount = useMemo(
    () => datasetList?.reduce((sum, d) => sum + (Number(d.testCaseCount) || 0), 0),
    [datasetList],
  );

  const isFirstUse = benchmarks.data !== undefined && benchmarkList.length === 0;

  return (
    <div className={styles.scroller}>
      <EvalPage
        header={
          <EvalPageHeader
            description={t('home.description')}
            title={t('overview.title')}
            actions={
              !isFirstUse && (
                <Button icon={Plus} type="primary" onClick={createBenchmark}>
                  {t('overview.createBenchmark')}
                </Button>
              )
            }
          />
        }
      >
        {/* The benchmark list anchors the page: a failed fetch is gated before the
            first-use empty so owners are never invited to re-create what they have. */}
        <AsyncBoundary
          data={benchmarks.data}
          error={benchmarks.error}
          isEmpty={benchmarkList.length === 0}
          isLoading={benchmarks.isLoading}
          loading={<HomeSkeleton />}
          empty={
            <EvalEmpty
              description={t('home.empty.description')}
              icon={FlaskConical}
              title={t('home.empty.title')}
              action={
                <Button icon={Plus} type="primary" onClick={createBenchmark}>
                  {t('overview.createBenchmark')}
                </Button>
              }
            />
          }
          onRetry={() => benchmarks.mutate()}
        >
          <Overview
            benchmarkCount={benchmarkList.length}
            datasetCount={datasetList?.length}
            datasetsError={datasets.error}
            runs={recent.runs}
            testCaseCount={testCaseCount}
            onRetryDatasets={() => datasets.mutate()}
          />

          <RecentRuns
            benchmarkIdByDataset={benchmarkIdByDataset}
            data={recent.data}
            error={recent.error}
            isLoading={recent.isLoading}
            runs={recent.runs}
            onRetry={() => recent.mutate()}
          />

          <EvalSection
            count={benchmarkList.length}
            description={t('overview.sections.benchmarks.subtitle')}
            title={t('overview.sections.benchmarks.title')}
          >
            <BenchmarkGrid benchmarks={benchmarkList} />
          </EvalSection>

          <ExperimentsSection />
        </AsyncBoundary>
      </EvalPage>
    </div>
  );
};

export default EvalHome;

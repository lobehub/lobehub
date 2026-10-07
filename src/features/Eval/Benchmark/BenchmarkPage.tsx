'use client';

import { Flexbox } from '@lobehub/ui';
import { Skeleton, SkeletonText, Tabs } from '@lobehub/ui/base-ui';
import { createStaticStyles, cssVar } from 'antd-style';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router';

import AsyncError from '@/components/AsyncError';
import EvalPage from '@/features/Eval/components/EvalPage';
import { runSelectors, useEvalStore } from '@/store/eval';

import BenchmarkHeader from './BenchmarkHeader';
import BenchmarkStats from './BenchmarkHeader/BenchmarkStats';
import DatasetsTab, { useCreateDataset } from './DatasetsTab';
import RunsTab from './RunsTab';

const styles = createStaticStyles(({ css }) => ({
  count: css`
    margin-inline-start: 6px;
    font-variant-numeric: tabular-nums;
    color: ${cssVar.colorTextTertiary};
  `,
}));

/** Shaped like the page: header, four stat tiles, tab strip, a list. */
const PageSkeleton = () => (
  <EvalPage
    header={
      <Flexbox horizontal align="flex-start" gap={12}>
        <Skeleton height={40} width={40} />
        <Flexbox flex={1} gap={8}>
          <Skeleton height={24} width={240} />
          <SkeletonText width={320} />
        </Flexbox>
        <Skeleton height={32} width={128} />
      </Flexbox>
    }
  >
    <Flexbox horizontal gap={12}>
      {[0, 1, 2, 3].map((i) => (
        <Skeleton height={84} key={i} style={{ flex: 1 }} />
      ))}
    </Flexbox>
    <Flexbox gap={16}>
      <Skeleton height={32} width={200} />
      <Skeleton height={160} />
    </Flexbox>
  </EvalPage>
);

type TabKey = 'datasets' | 'runs';

const BenchmarkDetail = () => {
  const { t } = useTranslation('eval');
  const { benchmarkId } = useParams<{ benchmarkId: string }>();
  const [tab, setTab] = useState<TabKey>('runs');

  const useFetchBenchmarkDetail = useEvalStore((s) => s.useFetchBenchmarkDetail);
  const benchmark = useEvalStore((s) =>
    benchmarkId ? s.benchmarkDetailMap[benchmarkId] : undefined,
  );
  const useFetchDatasets = useEvalStore((s) => s.useFetchDatasets);
  const useFetchRuns = useEvalStore((s) => s.useFetchRuns);
  const datasets = useEvalStore((s) => s.datasetList);
  const refreshDatasets = useEvalStore((s) => s.refreshDatasets);
  const runList = useEvalStore(runSelectors.runList);

  const { error, isLoading, mutate } = useFetchBenchmarkDetail(benchmarkId);
  useFetchDatasets(benchmarkId);
  useFetchRuns(benchmarkId);
  const createDataset = useCreateDataset(benchmarkId ?? '');

  if (!benchmarkId) return null;

  if (!benchmark) {
    if (isLoading || !error) return <PageSkeleton />;
    return <AsyncError error={error} variant={'page'} onRetry={() => void mutate()} />;
  }

  const caseCount = datasets.reduce((sum, ds: any) => sum + (ds.testCaseCount || 0), 0);

  const label = (text: string, count: number) => (
    <span>
      {text}
      <span className={styles.count}>{count}</span>
    </span>
  );

  return (
    <EvalPage
      header={
        <BenchmarkHeader
          benchmark={benchmark}
          caseCount={caseCount}
          datasetCount={datasets.length}
          runCount={runList.length}
          onAddDataset={createDataset}
          onUpdated={() => void refreshDatasets(benchmarkId)}
        />
      }
    >
      <BenchmarkStats caseCount={caseCount} datasetCount={datasets.length} runs={runList} />
      <Tabs
        activeKey={tab}
        variant="square"
        items={[
          {
            children: <RunsTab benchmarkId={benchmarkId} />,
            key: 'runs',
            label: label(t('benchmark.detail.tabs.runs'), runList.length),
          },
          {
            children: <DatasetsTab benchmarkId={benchmarkId} />,
            key: 'datasets',
            label: label(t('benchmark.detail.tabs.datasets'), datasets.length),
          },
        ]}
        onChange={(key) => setTab(key as TabKey)}
      />
    </EvalPage>
  );
};

export default BenchmarkDetail;

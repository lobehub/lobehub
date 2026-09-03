'use client';

import { Flexbox } from '@lobehub/ui';
import { createStaticStyles, cssVar } from 'antd-style';
import {
  Activity,
  Award,
  BarChart3,
  Gauge,
  LoaderPinwheel,
  Server,
  Target,
  TrendingUp,
  Trophy,
  Volleyball,
  Zap,
} from 'lucide-react';
import { memo, useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router';

import { BenchmarkDetailLoading } from '@/features/Eval';
import { runSelectors, useEvalStore } from '@/store/eval';

import BenchmarkHeader from './features/BenchmarkHeader';
import DatasetsTab from './features/DatasetsTab';
import RunsTab from './features/RunsTab';

const SYSTEM_ICONS = [
  LoaderPinwheel,
  Volleyball,
  Server,
  Target,
  Award,
  Trophy,
  Activity,
  BarChart3,
  TrendingUp,
  Gauge,
  Zap,
];

const getSystemIcon = (id: string) => {
  const hash = id.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
  return SYSTEM_ICONS[hash % SYSTEM_ICONS.length];
};

const styles = createStaticStyles(({ css }) => ({
  container: css`
    overflow-y: auto;
    padding-block: 24px;
    padding-inline: 32px;
  `,
  sectionTitle: css`
    margin: 0;
    font-size: ${cssVar.fontSizeLG};
    font-weight: 600;
    color: ${cssVar.colorText};
  `,
  tag: css`
    padding-block: 2px;
    padding-inline: 8px;
    border: 1px solid ${cssVar.colorBorder};
    border-radius: ${cssVar.borderRadiusXS};

    font-size: ${cssVar.fontSizeSM};
    color: ${cssVar.colorTextTertiary};

    background: transparent;
  `,
}));

const BenchmarkDetail = memo(() => {
  const { t } = useTranslation('eval');
  const { benchmarkId } = useParams<{ benchmarkId: string }>();
  const systemIcon = useMemo(
    () => (benchmarkId ? getSystemIcon(benchmarkId) : Server),
    [benchmarkId],
  );

  const useFetchBenchmarkDetail = useEvalStore((s) => s.useFetchBenchmarkDetail);
  const benchmark = useEvalStore((s) =>
    benchmarkId ? s.benchmarkDetailMap[benchmarkId] : undefined,
  );
  const useFetchDatasets = useEvalStore((s) => s.useFetchDatasets);
  const datasets = useEvalStore((s) => s.datasetList);
  const isLoadingDatasets = useEvalStore((s) => s.isLoadingDatasets);
  const refreshDatasets = useEvalStore((s) => s.refreshDatasets);
  const useFetchRuns = useEvalStore((s) => s.useFetchRuns);
  const runList = useEvalStore(runSelectors.runList);

  useFetchBenchmarkDetail(benchmarkId);
  useFetchDatasets(benchmarkId);

  const handleRefreshDatasets = useCallback(async () => {
    if (benchmarkId) {
      await refreshDatasets(benchmarkId);
    }
  }, [benchmarkId, refreshDatasets]);

  const handleBenchmarkUpdate = useCallback(async () => {
    if (benchmarkId) {
      await refreshDatasets(benchmarkId);
    }
  }, [benchmarkId, refreshDatasets]);

  // Fetch all runs for this benchmark
  useFetchRuns(benchmarkId);

  const completedRuns = runList.filter((r) => r.status === 'completed');

  const totalCases = datasets.reduce((sum, ds) => sum + (ds.testCaseCount || 0), 0);

  if (!benchmark)
    return (
      <Flexbox aria-busy className={styles.container} gap={24} height="100%" width="100%">
        <BenchmarkDetailLoading />
      </Flexbox>
    );

  return (
    <Flexbox className={styles.container} gap={24} height="100%" width="100%">
      {/* Header + Stats */}
      <BenchmarkHeader
        benchmark={benchmark}
        completedRuns={completedRuns}
        datasets={datasets}
        runCount={runList.length}
        systemIcon={systemIcon}
        totalCases={totalCases}
        onBenchmarkUpdate={handleBenchmarkUpdate}
      />

      {/* Tags */}
      {(benchmark as any).tags && (benchmark as any).tags.length > 0 && (
        <Flexbox horizontal gap={8} style={{ flexWrap: 'wrap' }}>
          {(benchmark as any).tags.map((tag: string) => (
            <span className={styles.tag} key={tag}>
              {tag}
            </span>
          ))}
        </Flexbox>
      )}

      {/* Datasets Section */}
      <h3 className={styles.sectionTitle}>{t('benchmark.detail.tabs.datasets')}</h3>
      <DatasetsTab
        benchmarkId={benchmarkId!}
        datasets={datasets}
        loading={isLoadingDatasets}
        onImport={() => {}}
        onRefresh={handleRefreshDatasets}
      />

      {/* Evaluations Section */}
      <h3 className={styles.sectionTitle}>{t('benchmark.detail.tabs.runs')}</h3>
      <RunsTab benchmarkId={benchmarkId!} />
    </Flexbox>
  );
});

export default BenchmarkDetail;

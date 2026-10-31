'use client';

import { Button, Empty, Flexbox, Text } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { Beaker, Database, Plus } from 'lucide-react';
import { memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { openCreateBenchmarkModal } from '@/features/LobeBench/BenchmarkModal';
import { pickRankedSet, rankContenders } from '@/features/LobeBench/benchmarkRanking';
import { BenchmarkCard, ExperimentCard } from '@/features/LobeBench/DashboardCards';
import {
  benchmarkDatasetsOf,
  caseCountOf,
  customDatasetsOf,
  experimentPartsOf,
  isCustomBenchmark,
  isLobeBenchMeta,
  isRunActive,
  LOBE_BENCH_PATH,
  looseDatasetsOf,
  rankableSetsOf,
  sortBenchmarks,
} from '@/features/LobeBench/lobeBench';
import {
  useLobeBenchBenchmarks,
  useLobeBenchDatasets,
  useLobeBenchExperiments,
  useLobeBenchRuns,
} from '@/features/LobeBench/useLobeBench';
import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import WorkspaceLink from '@/features/Workspace/WorkspaceLink';

const styles = stylex.create({
  container: {
    overflowY: 'auto',
    paddingBlockStart: 56,
    paddingBlockEnd: 32,
    paddingInline: 32,
  },
  grid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(min(480px, 100%), 1fr))',
    gap: 20,
  },
  sectionTitle: { margin: 0, fontSize: 18, fontWeight: 600 },
  datasetRow: {
    display: 'flex',
    gap: 12,
    alignItems: 'center',
    paddingBlock: 14,
    paddingInline: 16,
    borderWidth: 1,
    borderStyle: 'solid',
    borderColor: { 'default': cssVar.colorBorderSecondary, ':hover': cssVar.colorBorder },
    borderRadius: cssVar.borderRadiusLG,
    color: 'inherit',
    textDecoration: 'none',
  },
  datasetIcon: {
    display: 'flex',
    flex: 'none',
    alignItems: 'center',
    justifyContent: 'center',
    width: 32,
    height: 32,
    borderRadius: 10,
    backgroundColor: cssVar.colorFillTertiary,
  },
});

/**
 * The Lobe Bench dashboard, laid out as the Evaluation Lab's: experiments,
 * then benchmarks with who leads each, then every dataset.
 */
const LobeBenchDashboard = memo(() => {
  const { t } = useTranslation('eval');
  const navigate = useWorkspaceAwareNavigate();
  const { benchmarks: benchmarkList, isLoading: loadingBenchmarks } = useLobeBenchBenchmarks();
  const benchmarks = useMemo(() => sortBenchmarks(benchmarkList), [benchmarkList]);
  const benchmarkIds = useMemo(() => benchmarks.map((b) => b.id), [benchmarks]);
  const { data: datasets } = useLobeBenchDatasets(benchmarkIds);
  const { experiments } = useLobeBenchExperiments();
  const hasActive = experiments.some((e) => e.recentRuns?.some((r) => isRunActive(r.status)));
  const { data: runs } = useLobeBenchRuns(benchmarkIds, {
    refreshInterval: hasActive ? 5000 : undefined,
  });

  // The benchmark pages' ranking: per dataset, each contender's best judged full run
  // on the current cases. A card shows the dataset with the most contenders.
  const sets = useMemo(() => rankableSetsOf(benchmarks, datasets), [benchmarks, datasets]);
  const rankings = useMemo(
    () => new Map(sets.map((set) => [set.id, rankContenders(runs ?? [], set)])),
    [runs, sets],
  );

  // Built-in benchmarks' datasets first, in benchmark order, then the account's own.
  const listedDatasets = useMemo(
    () => [
      ...benchmarks
        .filter((b) => !isCustomBenchmark(b))
        .flatMap((b) => benchmarkDatasetsOf(datasets, b)),
      ...customDatasetsOf(datasets),
    ],
    [benchmarks, datasets],
  );

  const runsOf = (experimentId: string) =>
    (runs ?? []).filter((run) => run.experimentId === experimentId);
  // A run's page lives under its dataset's benchmark.
  const benchmarkIdOf = (run: { benchmarkId?: string; datasetId: string }) =>
    datasets?.find((d) => d.id === run.datasetId)?.benchmarkId ??
    run.benchmarkId ??
    benchmarkIds[0];

  const describeExperiment = (experiment: (typeof experiments)[number]) => {
    const meta = isLobeBenchMeta(experiment.metadata) ? experiment.metadata : undefined;
    // Named by the datasets it ran (an experiment can cover several benchmarks).
    const names = (meta ? experimentPartsOf(meta) : []).map(
      (part) => datasets?.find((d) => d.id === (part.pickedDatasetId ?? part.datasetId))?.name,
    );
    return t('lobeBench.experiment.line', {
      count: meta?.contenders.length ?? 0,
      dataset: names.length ? names.map((n) => n ?? '—').join(' + ') : '—',
      k: meta?.k ?? 1,
    });
  };

  const createBenchmark = () =>
    openCreateBenchmarkModal({
      datasets: looseDatasetsOf(datasets, benchmarks),
      onCreated: (id) => navigate(`${LOBE_BENCH_PATH}/benchmarks/${id}`),
    });
  const newExperiment = () => navigate(`${LOBE_BENCH_PATH}/experiments/new`);

  if (!loadingBenchmarks && benchmarks.length === 0) {
    return (
      <Flexbox className={stylex.props(styles.container).className} flex={1}>
        <Empty description={t('lobeBench.overview.notInstalled')} />
      </Flexbox>
    );
  }

  return (
    <Flexbox className={stylex.props(styles.container).className} flex={1} gap={32}>
      <Flexbox horizontal align={'center'} gap={16} justify={'space-between'}>
        <Flexbox gap={4} style={{ minWidth: 0 }}>
          <Text ellipsis as={'h1'} fontSize={30} style={{ lineHeight: 1.3 }} weight={600}>
            {t('lobeBench.title')}
          </Text>
          <Text type={'secondary'}>{t('lobeBench.subtitle')}</Text>
        </Flexbox>
        <Button icon={Plus} type={'primary'} onClick={createBenchmark}>
          {t('lobeBench.overview.createBenchmark')}
        </Button>
      </Flexbox>

      <Flexbox gap={16}>
        <Flexbox horizontal align={'center'} justify={'space-between'}>
          <h2 className={stylex.props(styles.sectionTitle).className}>
            {t('overview.sections.experiments.title')}
          </h2>
          <Button icon={Plus} size={'small'} onClick={newExperiment}>
            {t('lobeBench.overview.newExperiment')}
          </Button>
        </Flexbox>
        {experiments.length === 0 ? (
          <Empty description={t('lobeBench.overview.experiments.empty')} icon={Beaker}>
            <Button icon={Plus} style={{ marginTop: 16 }} type={'primary'} onClick={newExperiment}>
              {t('lobeBench.overview.newExperiment')}
            </Button>
          </Empty>
        ) : (
          <div className={stylex.props(styles.grid).className}>
            {experiments.map((experiment) => (
              <ExperimentCard
                benchmarkIdOf={benchmarkIdOf}
                description={describeExperiment(experiment)}
                experiment={experiment}
                key={experiment.id}
                runs={runsOf(experiment.id)}
              />
            ))}
          </div>
        )}
      </Flexbox>

      <Flexbox gap={16}>
        <h2 className={stylex.props(styles.sectionTitle).className}>
          {t('overview.sections.benchmarks.title')}
        </h2>
        <div className={stylex.props(styles.grid).className}>
          {benchmarks.map((benchmark) => {
            const madeOf = benchmarkDatasetsOf(datasets, benchmark);
            const own = sets.filter((set) => set.benchmarkId === benchmark.id);
            const ranked = pickRankedSet(own, rankings);
            return (
              <BenchmarkCard
                benchmark={benchmark}
                caseCount={madeOf.reduce((sum, d) => sum + caseCountOf(d), 0)}
                datasetCount={madeOf.length}
                firstDatasetId={madeOf[0]?.id}
                key={benchmark.id}
                ranking={(ranked && rankings.get(ranked.id)?.contenders) || []}
                rankedOn={
                  madeOf.length > 1 ? madeOf.find((d) => d.id === ranked?.id)?.name : undefined
                }
                runCount={
                  (runs ?? []).filter((run) => madeOf.some((d) => d.id === run.datasetId)).length
                }
              />
            );
          })}
        </div>
      </Flexbox>

      <Flexbox gap={16}>
        <h2 className={stylex.props(styles.sectionTitle).className}>
          {t('overview.sections.datasets.title')}
        </h2>
        {listedDatasets.length === 0 ? (
          <Text fontSize={12} type={'secondary'}>
            {t('lobeBench.sidebar.datasets.empty')}
          </Text>
        ) : (
          <div className={stylex.props(styles.grid).className}>
            {listedDatasets.map((dataset) => {
              const benchmark = benchmarks.find((b) => b.id === dataset.benchmarkId);
              // The account's datasets filed under a built-in benchmark are in none.
              const inBenchmark =
                benchmark && benchmarkDatasetsOf(datasets, benchmark).includes(dataset);
              return (
                <WorkspaceLink
                  className={stylex.props(styles.datasetRow).className}
                  key={dataset.id}
                  to={`${LOBE_BENCH_PATH}/datasets/${dataset.id}`}
                >
                  <div className={stylex.props(styles.datasetIcon).className}>
                    <Database size={16} style={{ color: cssVar.colorTextSecondary }} />
                  </div>
                  <Flexbox gap={2} style={{ minWidth: 0 }}>
                    <Text ellipsis weight={500}>
                      {dataset.name}
                    </Text>
                    <Text ellipsis fontSize={12} type={'secondary'}>
                      {t('lobeBench.benchmark.cases', { count: caseCountOf(dataset) })} ·{' '}
                      {inBenchmark ? benchmark.name : t('overview.sections.datasets.noBenchmark')}
                    </Text>
                  </Flexbox>
                </WorkspaceLink>
              );
            })}
          </div>
        )}
      </Flexbox>
    </Flexbox>
  );
});

LobeBenchDashboard.displayName = 'LobeBenchDashboard';

export default LobeBenchDashboard;

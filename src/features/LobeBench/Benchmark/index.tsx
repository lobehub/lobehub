'use client';

import {
  ActionIcon,
  Button,
  type DropdownItem,
  DropdownMenu,
  Empty,
  Flexbox,
  Text,
  toast,
} from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { Database, LibraryBig, Plus, X } from 'lucide-react';
import { memo, useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router';

import { getBenchmarkIcon } from '@/features/LobeBench/benchmarkIcon';
import ContenderRanking from '@/features/LobeBench/ContenderRanking';
import { moveDatasets } from '@/features/LobeBench/datasetCases';
import {
  benchmarkDatasetsOf,
  caseCountOf,
  getDatasetMeta,
  isCustomBenchmark,
  isRunActive,
  libraryOf,
  LOBE_BENCH_PATH,
  looseDatasetsOf,
  pickPrimaryBenchmark,
  rankableSetsOf,
  sortBenchmarks,
} from '@/features/LobeBench/lobeBench';
import RunsSection from '@/features/LobeBench/RunsSection';
import {
  useLobeBenchBenchmarks,
  useLobeBenchDatasets,
  useLobeBenchExperiments,
  useLobeBenchRuns,
} from '@/features/LobeBench/useLobeBench';
import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import WorkspaceLink from '@/features/Workspace/WorkspaceLink';
import BenchmarkTitleBar from '@/routes/(main)/eval/bench/[benchmarkId]/features/BenchmarkHeader/TitleBar';
import { useEvalStore } from '@/store/eval';

const styles = stylex.create({
  container: {
    overflowY: 'auto',
    paddingBlockStart: 56,
    paddingBlockEnd: 32,
    paddingInline: 32,
  },
  sectionTitle: {
    margin: 0,
    fontSize: cssVar.fontSizeLG,
    fontWeight: 600,
    color: cssVar.colorText,
  },
  datasetGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(360px, 1fr))',
    gap: 12,
  },
  datasetCard: {
    display: 'flex',
    alignItems: 'center',
    gap: 12,
    paddingBlock: 12,
    paddingInline: 16,
    borderWidth: 1,
    borderStyle: 'solid',
    borderColor: cssVar.colorBorderSecondary,
    borderRadius: cssVar.borderRadiusLG,
    color: cssVar.colorText,
    backgroundColor: {
      'default': 'transparent',
      ':hover': cssVar.colorFillQuaternary,
    },
  },
  filterEmpty: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingBlock: 48,
    paddingInline: 24,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: cssVar.colorBorderSecondary,
    borderRadius: cssVar.borderRadiusLG,
    backgroundColor: cssVar.colorFillQuaternary,
  },
});

/**
 * One Lobe Bench benchmark. It opens on what the benchmark is for: the models
 * ranked by their completed runs, under the same title row as the Evaluation
 * Lab's page. The datasets it is made of follow (a benchmark is made of
 * datasets), then its runs.
 */
const LobeBenchBenchmark = memo(() => {
  const { t } = useTranslation('eval');
  const navigate = useWorkspaceAwareNavigate();
  const { benchmarkId } = useParams<{ benchmarkId: string }>();
  const systemIcon = useMemo(() => getBenchmarkIcon(benchmarkId ?? ''), [benchmarkId]);

  const useFetchBenchmarkDetail = useEvalStore((s) => s.useFetchBenchmarkDetail);
  const benchmark = useEvalStore((s) =>
    benchmarkId ? s.benchmarkDetailMap[benchmarkId] : undefined,
  );
  const { isLoading } = useFetchBenchmarkDetail(benchmarkId);
  // Datasets and runs are read across all of Lobe Bench: the library (and the
  // mock settings every dataset shares) sits under another benchmark than Hard 50.
  const { benchmarks: benchmarkList } = useLobeBenchBenchmarks();
  const benchmarks = useMemo(() => sortBenchmarks(benchmarkList), [benchmarkList]);
  const benchmarkIds = useMemo(() => benchmarks.map((b) => b.id), [benchmarks]);
  const { data: datasets, mutate: refreshDatasets } = useLobeBenchDatasets(benchmarkIds);
  const { experiments } = useLobeBenchExperiments();
  const hasActive = experiments.some((e) => e.recentRuns?.some((r) => isRunActive(r.status)));
  const { data: allRuns, mutate: refreshRuns } = useLobeBenchRuns(benchmarkIds, {
    refreshInterval: hasActive ? 5000 : undefined,
  });
  const library = libraryOf(datasets);
  // Every dataset forwards to the library's mock service: its benchmark says whether it answers.
  const listed = benchmarks.find((b) => b.id === benchmarkId);
  // One the account made: it adds and removes its own datasets, and can be deleted.
  const custom = isCustomBenchmark(listed);
  const madeOf = useMemo(
    () => (listed ? benchmarkDatasetsOf(datasets, listed) : []),
    [datasets, listed],
  );
  // The account's datasets in no benchmark of its own: what it can add.
  const addable = useMemo(
    () => (custom ? looseDatasetsOf(datasets, benchmarks) : []),
    [benchmarks, custom, datasets],
  );
  // Where a dataset taken out of this benchmark goes back to: the library's benchmark.
  const homeBenchmarkId = library?.benchmarkId ?? pickPrimaryBenchmark(benchmarks)?.id;
  const deleteBenchmark = useEvalStore((s) => s.deleteBenchmark);
  const sets = useMemo(() => rankableSetsOf(benchmarks, datasets), [benchmarks, datasets]);
  const rankedSets = useMemo(
    () => sets.filter((set) => set.benchmarkId === benchmarkId),
    [benchmarkId, sets],
  );
  // The runs on this benchmark: every run on a dataset it is made of, as the
  // Evaluation Lab lists them (one on some of the cases says so).
  const runList = useMemo(
    () => (allRuns ?? []).filter((run) => madeOf.some((dataset) => dataset.id === run.datasetId)),
    [allRuns, madeOf],
  );

  const move = async (moved: typeof madeOf, to?: string) => {
    if (!to) return;
    try {
      await moveDatasets(moved, to);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('lobeBench.picks.failed'));
    }
  };
  // Only datasets already made: they are made in the Case library, with their
  // cases fixed, before a benchmark takes them.
  const addMenu: DropdownItem[] =
    addable.length > 0
      ? addable.map((dataset) => ({
          icon: <Database size={16} />,
          key: dataset.id,
          label: `${dataset.name} · ${t('lobeBench.benchmark.cases', { count: caseCountOf(dataset) })}`,
          onClick: () => move([dataset], benchmarkId),
        }))
      : [
          {
            icon: <LibraryBig size={16} />,
            key: 'library',
            label: t('lobeBench.benchmark.datasets.noneLoose'),
            onClick: () => navigate(`${LOBE_BENCH_PATH}/library`),
          },
        ];
  // Deleting one the account made gives its datasets back first: the database would
  // delete them with it.
  const handleDelete = async () => {
    if (!benchmarkId || !homeBenchmarkId) return;
    await moveDatasets(madeOf, homeBenchmarkId);
    await deleteBenchmark(benchmarkId);
    navigate(LOBE_BENCH_PATH);
  };

  const handleBenchmarkUpdate = useCallback(async () => {
    await refreshDatasets();
  }, [refreshDatasets]);

  if (!benchmark) {
    return (
      <Flexbox className={stylex.props(styles.container).className} flex={1}>
        {!isLoading && <Empty description={t('lobeBench.benchmark.notFound')} />}
      </Flexbox>
    );
  }

  return (
    <Flexbox className={stylex.props(styles.container).className} flex={1} gap={24}>
      <BenchmarkTitleBar
        benchmark={benchmark}
        systemIcon={systemIcon}
        deleteConfirm={
          custom ? t('lobeBench.benchmark.delete.confirm', { name: benchmark.name }) : undefined
        }
        onBenchmarkUpdate={handleBenchmarkUpdate}
        onDelete={custom ? handleDelete : undefined}
      />

      {/* A benchmark the account made with no dataset yet has nothing to rank. */}
      {rankedSets.length > 0 && (
        <ContenderRanking benchmarkId={benchmarkId!} runs={runList} sets={rankedSets} />
      )}

      {(madeOf.length > 0 || custom) && (
        <Flexbox gap={12}>
          <Flexbox horizontal align={'flex-end'} gap={16} justify={'space-between'}>
            <Flexbox gap={4}>
              <h3 className={stylex.props(styles.sectionTitle).className}>
                {t('lobeBench.benchmark.datasets')}
              </h3>
              <Text type={'secondary'}>{t('lobeBench.benchmark.datasets.hint')}</Text>
            </Flexbox>
            {custom && (
              <DropdownMenu items={addMenu} placement={'bottomRight'} trigger={['click']}>
                <Button icon={Plus} size={'small'}>
                  {t('lobeBench.benchmark.datasets.add')}
                </Button>
              </DropdownMenu>
            )}
          </Flexbox>
          {madeOf.length === 0 && (
            <Flexbox className={stylex.props(styles.filterEmpty).className}>
              <Text type={'secondary'}>{t('lobeBench.benchmark.datasets.empty')}</Text>
            </Flexbox>
          )}
          <div className={stylex.props(styles.datasetGrid).className}>
            {madeOf.map((dataset) => {
              const release = getDatasetMeta(dataset).release;
              return (
                <WorkspaceLink
                  className={stylex.props(styles.datasetCard).className}
                  key={dataset.id}
                  to={`${LOBE_BENCH_PATH}/datasets/${dataset.id}`}
                >
                  <Database size={18} style={{ color: cssVar.colorTextSecondary, flex: 'none' }} />
                  <Flexbox flex={1} gap={2} style={{ minWidth: 0 }}>
                    <Text ellipsis weight={500}>
                      {dataset.name}
                    </Text>
                    <Text ellipsis fontSize={12} type={'secondary'}>
                      {[
                        t('lobeBench.benchmark.cases', { count: caseCountOf(dataset) }),
                        release && t('lobeBench.dataset.release', { release }),
                      ]
                        .filter(Boolean)
                        .join(' · ')}
                    </Text>
                  </Flexbox>
                  {custom && (
                    <ActionIcon
                      icon={X}
                      size={'small'}
                      title={t('lobeBench.benchmark.datasets.remove')}
                      onClick={(e) => {
                        // The card is a link: taking the dataset out must not open it.
                        e.preventDefault();
                        e.stopPropagation();
                        move([dataset], homeBenchmarkId);
                      }}
                    />
                  )}
                </WorkspaceLink>
              );
            })}
          </div>
        </Flexbox>
      )}

      <RunsSection
        benchmarkId={benchmarkId}
        countLabel={(count) => t('lobeBench.benchmark.runCount', { count })}
        datasets={datasets}
        emptyLabel={t('lobeBench.benchmark.noRunsYet')}
        rankedSets={rankedSets}
        runs={runList}
        action={
          <Button
            icon={Plus}
            size={'small'}
            type={'primary'}
            onClick={() =>
              navigate(
                madeOf[0]
                  ? `${LOBE_BENCH_PATH}/experiments/new?dataset=${madeOf[0].id}`
                  : `${LOBE_BENCH_PATH}/experiments/new`,
              )
            }
          >
            {t('lobeBench.benchmark.newExperiment')}
          </Button>
        }
        onRefresh={refreshRuns}
      />
    </Flexbox>
  );
});

LobeBenchBenchmark.displayName = 'LobeBenchBenchmark';

export default LobeBenchBenchmark;

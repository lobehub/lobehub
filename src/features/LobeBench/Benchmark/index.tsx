'use client';

import {
  ActionIcon,
  Alert,
  Button,
  type DropdownItem,
  DropdownMenu,
  Empty,
  Flexbox,
  Select,
  Text,
  toast,
} from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { Database, LibraryBig, Plus, X } from 'lucide-react';
import { memo, useCallback, useMemo, useState } from 'react';
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
  isFullRun,
  isRunActive,
  isRunOnCaseVersion,
  libraryOf,
  LOBE_BENCH_PATH,
  looseDatasetsOf,
  pickPrimaryBenchmark,
  rankableSetsOf,
  runCaseCount,
  runCoversSet,
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
import { useClientDataSWR } from '@/libs/swr';
import BenchmarkTitleBar from '@/routes/(main)/eval/bench/[benchmarkId]/features/BenchmarkHeader/TitleBar';
import { createRunEditModal } from '@/routes/(main)/eval/bench/[benchmarkId]/features/RunEditModal';
import RunCard from '@/routes/(main)/eval/bench/[benchmarkId]/features/RunsTab/RunCard';
import { agentEvalService } from '@/services/agentEval';
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
  grid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(420px, 1fr))',
    gap: 12,
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
  const mockBenchmarkId = library?.benchmarkId ?? benchmarkId;
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

  const [statusFilter, setStatusFilter] = useState<string>('all');

  // Is the mock tool service this benchmark's runs forward to answering? Tool cases
  // fail without it, so the page says so before anyone starts an experiment.
  const {
    data: mock,
    isValidating: checkingMock,
    mutate: recheckMock,
  } = useClientDataSWR(mockBenchmarkId ? ['lobe-bench/mock-check', mockBenchmarkId] : null, () =>
    agentEvalService.checkBenchmarkMock(mockBenchmarkId!),
  );
  const mockProblem =
    mock?.configured && !mock.ok
      ? t('lobeBench.benchmark.mock.unreachable', { error: mock.error ?? `HTTP ${mock.status}` })
      : mock?.configured && mock.ok && !mock.tokenConfigured
        ? t('lobeBench.benchmark.mock.noToken')
        : undefined;

  const sortedRuns = useMemo(
    () =>
      [...runList].sort(
        (a, b) => new Date(b.createdAt ?? 0).getTime() - new Date(a.createdAt ?? 0).getTime(),
      ),
    [runList],
  );
  const filteredRuns = useMemo(() => {
    if (statusFilter === 'all') return sortedRuns;
    if (statusFilter === 'active') {
      return sortedRuns.filter((r) => r.status === 'running' || r.status === 'pending');
    }
    return sortedRuns.filter((r) => r.status === statusFilter);
  }, [sortedRuns, statusFilter]);

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

  const handleRefreshRuns = useCallback(async () => {
    await refreshRuns();
  }, [refreshRuns]);
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

  const statusOptions = [
    { label: t('table.filter.all'), value: 'all' },
    { label: t('run.status.completed'), value: 'completed' },
    { label: t('run.filter.active'), value: 'active' },
    { label: t('run.status.idle'), value: 'idle' },
    { label: t('run.status.failed'), value: 'failed' },
    { label: t('run.status.aborted'), value: 'aborted' },
  ];

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

      {mockProblem && (
        <Alert
          showIcon
          title={mockProblem}
          type={'warning'}
          action={
            <Button loading={checkingMock} size={'small'} onClick={() => recheckMock()}>
              {t('lobeBench.benchmark.mock.retry')}
            </Button>
          }
        />
      )}

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

      <Flexbox gap={16}>
        <Flexbox horizontal align={'center'} justify={'space-between'}>
          <Flexbox horizontal align={'center'} gap={8}>
            <h3 className={stylex.props(styles.sectionTitle).className}>
              {t('lobeBench.benchmark.runs')}
            </h3>
            {sortedRuns.length > 0 && (
              <>
                <Text type={'secondary'}>
                  {t('lobeBench.benchmark.runCount', { count: filteredRuns.length })}
                </Text>
                <Select
                  options={statusOptions}
                  size={'small'}
                  style={{ width: 128 }}
                  value={statusFilter}
                  onChange={(value) => setStatusFilter(value as string)}
                />
              </>
            )}
          </Flexbox>
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
        </Flexbox>
        {sortedRuns.length === 0 ? (
          <Flexbox className={stylex.props(styles.filterEmpty).className}>
            <Text type={'secondary'}>{t('lobeBench.benchmark.noRunsYet')}</Text>
          </Flexbox>
        ) : filteredRuns.length === 0 ? (
          <Flexbox className={stylex.props(styles.filterEmpty).className}>
            <Text type={'secondary'}>{t('run.filter.empty')}</Text>
          </Flexbox>
        ) : (
          <div className={stylex.props(styles.grid).className}>
            {filteredRuns.map((run) => {
              const setSize =
                datasets?.find((dataset) => dataset.id === run.datasetId)?.testCaseCount ?? 0;
              return (
                <RunCard
                  benchmarkId={benchmarkId!}
                  key={run.id}
                  run={run}
                  note={
                    // A run on an earlier version of the cases stays listed, but does not rank.
                    rankedSets.some(
                      (set) => runCoversSet(run, set) && !isRunOnCaseVersion(run, set),
                    )
                      ? t('lobeBench.benchmark.outdatedRun')
                      : isFullRun(run) || !setSize
                        ? undefined
                        : t('lobeBench.benchmark.runCases', {
                            selected: runCaseCount(run, setSize),
                            total: setSize,
                          })
                  }
                  onEdit={(editingRun) => createRunEditModal({ run: editingRun })}
                  onRefresh={handleRefreshRuns}
                />
              );
            })}
          </div>
        )}
      </Flexbox>
    </Flexbox>
  );
});

LobeBenchBenchmark.displayName = 'LobeBenchBenchmark';

export default LobeBenchBenchmark;

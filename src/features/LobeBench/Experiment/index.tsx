'use client';

import { evalCaseVersionOf } from '@lobechat/types';
import {
  Alert,
  Block,
  Button,
  confirmModal,
  type DropdownItem,
  DropdownMenu,
  Flexbox,
  Segmented,
  Tabs,
  Tag,
  Text,
} from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import { media } from '@lobehub/ui/stylex/media.stylex';
import * as stylex from '@stylexjs/stylex';
import { Download, Ellipsis, Pencil, Trash2 } from 'lucide-react';
import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router';

import AsyncError from '@/components/AsyncError';
import { ExperimentCaseDetails } from '@/features/LobeBench/ExperimentCaseDetails';
import { ExperimentCaseRow, verdictStyle } from '@/features/LobeBench/ExperimentCaseRow';
import { openExperimentEditModal } from '@/features/LobeBench/ExperimentEditModal';
import { ExperimentGradingNotices } from '@/features/LobeBench/ExperimentGradingNotices';
import {
  createExperimentResultsCsv,
  defaultExperimentCaseFilter,
  type ExperimentCaseFilter,
  experimentGradingGaps,
  experimentResultCoverage,
  experimentResultsState,
  isUnavailableExperimentResult,
  lowestPassRateCategory,
  orderExperimentContenders,
  scopeExperimentCases,
  unverifiedCaseCount,
} from '@/features/LobeBench/experimentResults';
import { ExperimentResultsState } from '@/features/LobeBench/ExperimentResultsLoading';
import {
  CASE_LEVELS,
  type CaseLevel,
  describeSettings,
  experimentPartMeta,
  experimentPartsOf,
  formatCost,
  formatPercent,
  getCaseCategory,
  getCaseConnectors,
  getCaseIndex,
  getCaseLevel,
  getCaseTitle,
  isLobeBenchMeta,
  isRunActive,
  levelLabelKey,
  type LobeBenchContender,
  runCaseVersion,
  runStats,
  summarizeCaseResult,
} from '@/features/LobeBench/lobeBench';
import { useDeleteExperiment } from '@/features/LobeBench/useDeleteExperiment';
import { useExperimentActions } from '@/features/LobeBench/useExperimentActions';
import {
  useDatasetCases,
  useExperimentRuns,
  useLobeBenchBenchmarks,
  useLobeBenchDatasets,
  useLobeBenchExperiments,
  useRunResultsMap,
} from '@/features/LobeBench/useLobeBench';

const styles = stylex.create({
  container: {
    minWidth: 0,
    maxWidth: '100%',
    overflowX: 'hidden',
    overflowY: 'auto',
    paddingBlockStart: 56,
    paddingBlockEnd: 32,
    paddingInline: { default: 32, [media.md]: 16 },
  },
  tableScroll: { overflowX: 'auto', minWidth: 0, maxWidth: '100%' },
  insights: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
    gap: 12,
  },
  mono: { fontFamily: cssVar.fontFamilyCode, fontVariantNumeric: 'tabular-nums' },
  grid: { display: 'grid', columnGap: 8, rowGap: 2, alignItems: 'center' },
  head: {
    paddingBlock: 6,
    paddingInline: 8,
    fontSize: 12,
    color: cssVar.colorTextSecondary,
  },
  cell: { paddingBlock: 8, paddingInline: 8, borderRadius: cssVar.borderRadius },
  heat: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 36,
    borderRadius: cssVar.borderRadius,
    fontFamily: cssVar.fontFamilyCode,
    fontSize: 12,
  },
});

type Tab = 'cases' | 'results' | 'setup';

const heatStyle = (rate: number | undefined) => {
  if (rate === undefined)
    return { background: cssVar.colorFillQuaternary, color: cssVar.colorTextQuaternary };
  const alpha = 0.12 + rate * 0.5;
  return {
    background: `color-mix(in srgb, ${cssVar.colorSuccess} ${Math.round(alpha * 100)}%, transparent)`,
    color: cssVar.colorText,
  };
};

const ExperimentDashboard = memo(() => {
  const { t } = useTranslation('eval');
  const { experimentId } = useParams<{ experimentId: string }>();
  const deleteExperiment = useDeleteExperiment();
  const {
    experiments,
    isInit,
    error: experimentsError,
    mutate: refreshExperiments,
  } = useLobeBenchExperiments();
  const experiment = experiments.find((e) => e.id === experimentId);
  const experimentMeta = isLobeBenchMeta(experiment?.metadata) ? experiment!.metadata : undefined;
  // An experiment can cover several benchmarks, one dataset each;
  // the page shows one at a time, as an experiment of that dataset alone.
  const parts = useMemo(
    () => (experimentMeta ? experimentPartsOf(experimentMeta) : []),
    [experimentMeta],
  );
  const [partIndex, setPartIndex] = useState(0);
  const part = parts[Math.min(partIndex, parts.length - 1)];
  const meta = useMemo(
    () => (experimentMeta && part ? experimentPartMeta(experimentMeta, part) : experimentMeta),
    [experimentMeta, part],
  );
  const {
    benchmarks,
    error: benchmarksError,
    mutate: refreshBenchmarks,
  } = useLobeBenchBenchmarks();
  const benchmarkIds = useMemo(() => benchmarks.map((b) => b.id), [benchmarks]);
  const {
    data: datasets,
    error: datasetsError,
    mutate: refreshDatasets,
  } = useLobeBenchDatasets(benchmarkIds);
  const dataset = datasets?.find((d) => d.id === meta?.datasetId);
  // Made on an earlier version of the cases than the dataset has now: still readable,
  // but no leaderboard counts it.
  const currentCaseVersion = evalCaseVersionOf(
    dataset?.metadata as Record<string, unknown> | undefined,
  );
  const benchmarkId = dataset?.benchmarkId ?? benchmarks[0]?.id;

  const [polling, setPolling] = useState(true);
  const {
    data: runs,
    error: runsError,
    mutate: refreshRuns,
  } = useExperimentRuns(experimentId, {
    refreshInterval: polling ? 5000 : undefined,
  });
  const active = (runs ?? []).some((run) => isRunActive(run.status));
  const outdated =
    !!currentCaseVersion &&
    (runs ?? []).some(
      (run) => run.datasetId === dataset?.id && runCaseVersion(run) !== currentCaseVersion,
    );

  const k = meta?.k ?? 1;
  const contenders: LobeBenchContender[] = useMemo(() => {
    const declared = meta?.contenders ?? [];
    // Runs are the source of truth once started; declared contenders keep the
    // display order and settings.
    // Before the run ids are saved a run is found by its name; with several datasets
    // only among the runs on the dataset shown.
    const onShownPart = (item: NonNullable<typeof runs>[number]) =>
      parts.length < 2 ||
      (item.datasetId === meta?.datasetId &&
        (item.config?.caseSelection?.caseIds ?? []).join() === (meta?.caseIds ?? []).join());
    return declared.map((contender) => {
      const run = (runs ?? []).find(
        (item) =>
          item.id === contender.runId ||
          (!contender.runId && item.name === contender.name && onShownPart(item)),
      );
      return { ...contender, runId: run?.id ?? contender.runId };
    });
  }, [meta, parts.length, runs]);
  const runIds = useMemo(
    () => contenders.map((c) => c.runId).filter(Boolean) as string[],
    [contenders],
  );
  const {
    data: resultsMap,
    error: resultsError,
    mutate: refreshResults,
  } = useRunResultsMap(runIds, {
    refreshInterval: active ? 5000 : undefined,
  });
  const {
    data: datasetCases,
    error: casesError,
    mutate: refreshCases,
  } = useDatasetCases(meta?.datasetId);
  const scope = useMemo(
    () => scopeExperimentCases(datasetCases ?? [], meta?.caseIds),
    [datasetCases, meta?.caseIds],
  );
  const cases = scope.cases;

  const wasActive = useRef(active);
  useEffect(() => {
    if (runs) setPolling(active);
    if (wasActive.current && !active) void refreshResults();
    wasActive.current = active;
  }, [active, runs, refreshResults]);

  const [tab, setTab] = useState<Tab>('results');
  const [filterOverride, setFilter] = useState<ExperimentCaseFilter>();
  const filter = filterOverride ?? defaultExperimentCaseFilter(contenders.length);
  const [category, setCategory] = useState<string>();
  const [level, setLevel] = useState<CaseLevel>();
  const [openCase, setOpenCase] = useState<string>();
  const [refreshing, setRefreshing] = useState(false);
  useEffect(() => {
    setFilter(undefined);
    setCategory(undefined);
    setLevel(undefined);
    setOpenCase(undefined);
  }, [experimentId]);

  const resources = [
    { error: experimentsError, loaded: isInit },
    { error: runsError, loaded: runs !== undefined },
    { error: casesError, loaded: !meta || datasetCases !== undefined },
    { error: resultsError, loaded: runIds.length === 0 || resultsMap !== undefined },
  ];
  const loadState = experimentResultsState(resources);
  const loadError = resources.find((item) => !item.loaded && item.error)?.error;
  const refreshError =
    experimentsError ?? runsError ?? casesError ?? resultsError ?? benchmarksError ?? datasetsError;
  const reload = async () => {
    setRefreshing(true);
    try {
      await Promise.allSettled([
        refreshExperiments(),
        refreshRuns(),
        refreshCases(),
        refreshResults(),
        refreshBenchmarks(),
        refreshDatasets(),
      ]);
    } finally {
      setRefreshing(false);
    }
  };
  const clearFilters = () => {
    setFilter('all');
    setCategory(undefined);
    setLevel(undefined);
  };
  const hasFilters = filter !== 'all' || !!category || !!level;

  const runOf = (contender: LobeBenchContender) =>
    (runs ?? []).find((r) => r.id === contender.runId);
  const statsOf = (contender: LobeBenchContender) =>
    runStats(runOf(contender), scope.selectedCount);
  const resultUnavailable = (contender: LobeBenchContender, caseId: string) =>
    isUnavailableExperimentResult(
      runOf(contender)?.status,
      contender.runId ? resultsMap?.[contender.runId] : undefined,
      caseId,
    );
  const coverageGaps = contenders.flatMap((contender) => {
    const run = runOf(contender);
    const coverage =
      run?.status === 'completed'
        ? experimentResultCoverage(statsOf(contender).total, resultsMap?.[run.id])
        : undefined;
    return coverage?.missing ? [{ ...coverage, id: contender.id, name: contender.name }] : [];
  });
  const gradingGaps = experimentGradingGaps(contenders, runs ?? [], resultsMap);
  const incomplete =
    coverageGaps.length > 0 ||
    gradingGaps.length > 0 ||
    contenders.some((c) => runOf(c)?.status !== 'completed');
  const attemptOf = (contender: LobeBenchContender, caseId: string) =>
    summarizeCaseResult(
      contender.runId
        ? resultsMap?.[contender.runId]?.find((r) => r.testCaseId === caseId)
        : undefined,
      k,
    );

  const ranked = useMemo(
    () =>
      orderExperimentContenders(contenders, (contender) => statsOf(contender).passed, incomplete),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [contenders, runs, scope.selectedCount, incomplete],
  );
  const categories = useMemo(
    () => [...new Set((cases ?? []).map((item) => getCaseCategory(item)))],
    [cases],
  );
  const levels = useMemo(() => {
    const present = new Set((cases ?? []).map((item) => getCaseLevel(item)));
    return CASE_LEVELS.filter((item) => present.has(item));
  }, [cases]);
  const levelRate = (contender: LobeBenchContender, item: string) => {
    const graded = (cases ?? [])
      .filter((c) => getCaseLevel(c) === item)
      .map((c) => attemptOf(contender, c.id))
      .filter((a) => a.verdict === 'passed' || a.verdict === 'failed');
    if (graded.length === 0) return undefined;
    return graded.filter((a) => a.verdict === 'passed').length / graded.length;
  };
  const categoryRate = (contender: LobeBenchContender, cat: string) => {
    const items = (cases ?? []).filter((item) => getCaseCategory(item) === cat);
    const graded = items
      .map((item) => attemptOf(contender, item.id))
      .filter((a) => a.verdict === 'passed' || a.verdict === 'failed');
    if (graded.length === 0) return undefined;
    return graded.filter((a) => a.verdict === 'passed').length / graded.length;
  };

  const errors = contenders.reduce((sum, c) => sum + statsOf(c).errors, 0);
  // Progress and spend count the whole experiment, every dataset it covers; the
  // rest of the page is the dataset shown.
  const experimentStats =
    parts.length > 1
      ? (runs ?? []).map((run) => runStats(run))
      : contenders.map((contender) => statsOf(contender));
  const totalAttempts = experimentStats.reduce((sum, stats) => sum + stats.total * k, 0);
  const doneAttempts = experimentStats.reduce((sum, stats) => sum + stats.completed * k, 0);
  const spent = experimentStats.reduce((sum, stats) => sum + (stats.totalCost ?? 0), 0);
  const labels = {
    reasoning: t('lobeBench.contender.settings.reasoning'),
    temperature: t('lobeBench.contender.settings.temperature'),
    topP: t('lobeBench.contender.settings.topP'),
  };
  const settingsOf = (c: LobeBenchContender) =>
    describeSettings(c.params, c.chatConfig, labels) || t('lobeBench.contender.settings.default');

  const actions = useExperimentActions({
    experimentId,
    refreshRuns,
    refreshResults,
    onRerunStarted: () => setPolling(true),
    // Every run of the experiment, on every dataset it covers: Stop stops them all.
    // Rerun needs a run's results, which load for the dataset shown.
    targets: (runs ?? []).map((run) => ({
      runId: run.id,
      name: run.name ?? '',
      status: run.status ?? '',
      unverified: unverifiedCaseCount(resultsMap?.[run.id]),
    })),
  });

  const stop = () =>
    confirmModal({
      content: t('lobeBench.dashboard.abort.confirm'),
      okButtonProps: { danger: true },
      okText: t('lobeBench.dashboard.abort'),
      onOk: actions.stop,
      title: t('lobeBench.dashboard.abort'),
    });

  // One row per case, one column per contender: the verdict, and the passes
  // out of k when the experiment made several attempts.
  const exportCsv = () => {
    const csv = createExperimentResultsCsv(
      cases.map((item) => ({
        ...item,
        index: getCaseIndex(item),
        title: getCaseTitle(item),
        category: getCaseCategory(item),
        results: contenders.map((c) => {
          if (resultUnavailable(c, item.id)) return 'unavailable';
          const a = attemptOf(c, item.id);
          return k > 1 ? `${a.verdict} ${a.passCount}/${a.total}` : a.verdict;
        }),
      })),
      contenders.map((c) => c.name),
      meta?.caseIds,
    );
    const blob = new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `${experiment?.name || 'experiment'}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const filteredCases = useMemo(() => {
    let list = cases ?? [];
    if (category) list = list.filter((item) => getCaseCategory(item) === category);
    if (level) list = list.filter((item) => getCaseLevel(item) === level);
    if (filter === 'diff')
      list = list.filter((item) => {
        const passes = new Set(contenders.map((c) => attemptOf(c, item.id).passCount));
        return passes.size > 1;
      });
    if (filter === 'allFail')
      list = list.filter((item) =>
        contenders.every((c) => attemptOf(c, item.id).verdict === 'failed'),
      );
    if (filter === 'errors')
      list = list.filter((item) =>
        contenders.some((c) => ['error', 'timeout'].includes(attemptOf(c, item.id).verdict)),
      );
    if (filter === 'judgeErrors')
      list = list.filter((item) =>
        contenders.some(
          (c) =>
            attemptOf(c, item.id).verdict === 'judge_error' ||
            attemptOf(c, item.id).threads.some((thread) => thread.status === 'judge_error'),
        ),
      );
    return list;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cases, category, level, filter, contenders, resultsMap]);

  const stateProps = {
    className: stylex.props(styles.container).className,
    name: experiment?.name,
    onRetry: reload,
    retrying: refreshing,
  };
  if ((experimentsError && !isInit) || loadState === 'error')
    return (
      <ExperimentResultsState
        {...stateProps}
        error={loadError ?? experimentsError}
        state={'error'}
      />
    );
  if (isInit && (!experiment || !meta))
    return <ExperimentResultsState {...stateProps} state={'notFound'} />;
  if (!experiment || !meta || loadState === 'loading')
    return <ExperimentResultsState {...stateProps} state={'loading'} />;
  if (!contenders.length || contenders.some((contender) => !runOf(contender)))
    return <ExperimentResultsState {...stateProps} state={'missingRuns'} />;

  const leader = ranked[0];
  const leaderStats = leader ? statsOf(leader) : undefined;
  const second = ranked[1] ? statsOf(ranked[1]) : undefined;
  const weakest = lowestPassRateCategory(
    categories.map((cat) => {
      const rates = contenders
        .map((c) => categoryRate(c, cat))
        .filter((r): r is number => r !== undefined);
      return {
        cat,
        rate: rates.length ? rates.reduce((a, b) => a + b, 0) / rates.length : undefined,
      };
    }),
  );
  const openItem = openCase ? cases?.find((item) => item.id === openCase) : undefined;
  const gridColumns = `minmax(0, 1fr) ${contenders.map(() => '110px').join(' ')}`;

  const edit = () => {
    if (experiment) openExperimentEditModal(experiment, () => refreshExperiments());
  };
  // Same header as the Lab's experiment page: Edit beside a "more" menu that holds
  // export and delete; the run-state actions (rerun, stop) stay as buttons.
  const menuItems: DropdownItem[] = [
    {
      icon: <Download size={16} />,
      key: 'export',
      label: t('lobeBench.dashboard.export'),
      onClick: exportCsv,
    },
    {
      danger: true,
      disabled: active,
      icon: <Trash2 size={16} />,
      key: 'delete',
      label: active ? t('lobeBench.experiment.delete.active') : t('common.delete'),
      onClick: () => {
        if (experiment) deleteExperiment(experiment, { active, leave: true });
      },
    },
  ];

  return (
    <Flexbox className={stylex.props(styles.container).className} flex={1} gap={20}>
      <Flexbox gap={6}>
        <Flexbox horizontal align={'flex-start'} gap={16} justify={'space-between'} wrap={'wrap'}>
          <Text
            as={'h1'}
            ellipsis={{ tooltipWhenOverflow: true }}
            fontSize={24}
            style={{ minWidth: 0, flex: '1 1 220px' }}
            weight={600}
          >
            {experiment.name || t('lobeBench.experiment.unnamed')}
          </Text>
          <Flexbox horizontal gap={8} style={{ flexShrink: 0, maxWidth: '100%' }} wrap={'wrap'}>
            <Button
              aria-label={t('error.retry', { ns: 'error' })}
              loading={refreshing}
              size={'small'}
              onClick={reload}
            >
              {t('error.retry', { ns: 'error' })}
            </Button>
            {active ? (
              <Button
                danger
                disabled={actions.busy}
                loading={actions.pendingAction === 'stop'}
                size={'small'}
                onClick={stop}
              >
                {t('lobeBench.dashboard.abort')}
              </Button>
            ) : (
              <Button
                disabled={actions.busy || !actions.canRerun}
                loading={actions.pendingAction === 'rerun'}
                size={'small'}
                title={
                  actions.canRerun
                    ? t('lobeBench.dashboard.rerun.hint')
                    : t('lobeBench.dashboard.rerun.none')
                }
                onClick={() =>
                  confirmModal({
                    content: t('lobeBench.dashboard.rerun.confirm', { count: actions.rerunCases }),
                    okText: t('lobeBench.dashboard.rerun'),
                    onOk: actions.rerun,
                    title: t('lobeBench.dashboard.rerun'),
                  })
                }
              >
                {t('lobeBench.dashboard.rerun')}
              </Button>
            )}
            <Button icon={Pencil} size={'small'} onClick={edit}>
              {t('common.edit')}
            </Button>
            <DropdownMenu items={menuItems} placement={'bottomRight'} trigger={['click']}>
              <Button aria-label={t('lobeBench.experiment.more')} icon={Ellipsis} size={'small'} />
            </DropdownMenu>
          </Flexbox>
        </Flexbox>
        {meta.question && <Text type={'secondary'}>{meta.question}</Text>}
        <Flexbox horizontal align={'center'} gap={8} wrap={'wrap'}>
          <Tag>
            {datasets?.find((d) => d.id === meta.pickedDatasetId)?.name ?? dataset?.name ?? '—'}
          </Tag>
          <Tag>
            {t('lobeBench.experiment.line', {
              count: contenders.length,
              dataset: meta.caseIds?.length
                ? t('lobeBench.new.cases.selected', {
                    selected: scope.selectedCount,
                    total: datasetCases?.length ?? 0,
                  })
                : t('lobeBench.new.dataset.cases', {
                    count: Math.max(...contenders.map((c) => statsOf(c).total)),
                  }),
              k,
            })}
          </Tag>
          <Tag color={active ? 'processing' : incomplete ? 'warning' : 'success'}>
            {active
              ? t('lobeBench.status.running', { done: doneAttempts, total: totalAttempts })
              : incomplete
                ? t('lobeBench.dashboard.statusIncomplete')
                : t('lobeBench.status.done')}
          </Tag>
          {spent > 0 && <Tag>{t('lobeBench.dashboard.spent', { cost: formatCost(spent, 2) })}</Tag>}
          {outdated && <Tag color={'warning'}>{t('lobeBench.experiment.outdated')}</Tag>}
        </Flexbox>
        {parts.length > 1 && (
          <Segmented
            value={String(Math.min(partIndex, parts.length - 1))}
            options={parts.map((item, index) => ({
              label:
                datasets?.find((d) => d.id === (item.pickedDatasetId ?? item.datasetId))?.name ??
                '—',
              value: String(index),
            }))}
            onChange={(value) => setPartIndex(Number(value))}
          />
        )}
      </Flexbox>

      {refreshError && (
        <AsyncError
          error={refreshError}
          retrying={refreshing}
          title={t('lobeBench.dashboard.loadError')}
          variant={'inline'}
          onRetry={reload}
        />
      )}
      {scope.missingCount > 0 && (
        <Alert
          title={t('lobeBench.dashboard.missingCases', { count: scope.missingCount })}
          type={'warning'}
        />
      )}
      {coverageGaps.map((gap) => (
        <Alert key={gap.id} title={t('lobeBench.dashboard.coverageGap', gap)} type={'warning'} />
      ))}
      <ExperimentGradingNotices gaps={gradingGaps} />

      {active && (
        <Block padding={12} variant={'outlined'}>
          <Text fontSize={13}>
            {t('lobeBench.dashboard.progress', { done: doneAttempts, total: totalAttempts })}
          </Text>
        </Block>
      )}
      {errors > 0 && !active && (
        <Block padding={12} variant={'outlined'}>
          <Text fontSize={13}>{t('lobeBench.dashboard.errors', { count: errors })}</Text>
        </Block>
      )}

      <Tabs
        activeKey={tab}
        items={[
          { key: 'results', label: t('lobeBench.dashboard.tabs.results') },
          { key: 'cases', label: t('lobeBench.dashboard.tabs.cases') },
          { key: 'setup', label: t('lobeBench.dashboard.tabs.setup') },
        ]}
        onChange={(key) => setTab(key as Tab)}
      />

      {tab === 'results' && (
        <Flexbox gap={20}>
          {!incomplete && leader && leaderStats && (
            <div className={stylex.props(styles.insights).className}>
              <Block padding={14} variant={'outlined'}>
                <Text fontSize={12} type={'secondary'}>
                  {t('lobeBench.dashboard.insight.leader')}
                </Text>
                <Text weight={600}>{leader.name}</Text>
                <Text fontSize={12} type={'secondary'}>
                  {k > 1
                    ? t('lobeBench.dashboard.insight.leaderLine', {
                        anyK: leaderStats.anyK ?? leaderStats.passed,
                        k,
                        passed: leaderStats.passed,
                        total: leaderStats.total,
                      })
                    : t('lobeBench.overview.passedOf', {
                        passed: leaderStats.passed,
                        total: leaderStats.total,
                      })}
                </Text>
              </Block>
              {second && (
                <Block padding={14} variant={'outlined'}>
                  <Text fontSize={12} type={'secondary'}>
                    {t('lobeBench.dashboard.insight.gap')}
                  </Text>
                  <Text weight={600}>
                    {t('lobeBench.dashboard.insight.gapLine', {
                      gap: leaderStats.passed - second.passed,
                    })}
                  </Text>
                  <Text fontSize={12} type={'secondary'}>
                    {ranked[1].name} · {second.passed}/{second.total}
                  </Text>
                </Block>
              )}
              {weakest && (
                <Block padding={14} variant={'outlined'}>
                  <Text fontSize={12} type={'secondary'}>
                    {t(
                      contenders.length === 1
                        ? 'lobeBench.dashboard.insight.lowest'
                        : 'lobeBench.dashboard.insight.weakest',
                    )}
                  </Text>
                  <Text weight={600}>{weakest.cat}</Text>
                  <Text fontSize={12} type={'secondary'}>
                    {t('lobeBench.dashboard.insight.weakestLine', {
                      rate: formatPercent(weakest.rate!),
                    })}
                  </Text>
                </Block>
              )}
            </div>
          )}

          <Block
            className={stylex.props(styles.tableScroll).className}
            padding={12}
            variant={'outlined'}
          >
            <Flexbox gap={6}>
              <Text weight={600}>
                {t(incomplete ? 'lobeBench.contenders.title' : 'lobeBench.dashboard.ranking')}
              </Text>
              <div
                className={stylex.props(styles.grid).className}
                style={{
                  minWidth: 640,
                  gridTemplateColumns: '28px minmax(0, 1fr) 90px 80px 110px 150px',
                }}
              >
                <span className={stylex.props(styles.head).className}>#</span>
                <span className={stylex.props(styles.head).className}>
                  {t('lobeBench.dashboard.col.contender')}
                </span>
                <span className={stylex.props(styles.head).className}>
                  {k > 1
                    ? t('lobeBench.dashboard.col.passRateAllK', { k })
                    : t('lobeBench.dashboard.col.passRate')}
                </span>
                <span className={stylex.props(styles.head).className}>
                  {t('lobeBench.dashboard.col.passed')}
                </span>
                <span className={stylex.props(styles.head).className}>
                  {k > 1 ? t('lobeBench.dashboard.col.anyK', { k }) : ''}
                </span>
                <span className={stylex.props(styles.head).className}>
                  {t('lobeBench.dashboard.col.cost')}
                </span>
                {ranked.map((contender, index) => {
                  const s = statsOf(contender);
                  const run = runOf(contender);
                  const hasGap =
                    run?.status !== 'completed' ||
                    coverageGaps.some((gap) => gap.id === contender.id) ||
                    gradingGaps.some((gap) => gap.id === contender.id);
                  return [
                    <span
                      className={stylex.props(styles.cell, styles.mono).className}
                      key={`${contender.id}-rank`}
                      style={{ color: cssVar.colorTextQuaternary }}
                    >
                      {incomplete ? '—' : index + 1}
                    </span>,
                    <Flexbox
                      className={stylex.props(styles.cell).className}
                      gap={2}
                      key={`${contender.id}-name`}
                      style={{ minWidth: 0 }}
                    >
                      <Flexbox horizontal align={'center'} gap={8}>
                        <Text ellipsis weight={500}>
                          {contender.name}
                        </Text>
                        {s.errors > 0 && (
                          <Tag color={'warning'}>
                            {t('lobeBench.dashboard.col.errors', { count: s.errors })}
                          </Tag>
                        )}
                        {hasGap && (
                          <Tag color={'warning'}>{t('lobeBench.dashboard.statusIncomplete')}</Tag>
                        )}
                        {run && isRunActive(run.status) && (
                          <Tag color={'processing'}>{t('lobeBench.overview.running')}</Tag>
                        )}
                      </Flexbox>
                      <Text fontSize={12} type={'secondary'}>
                        {settingsOf(contender)}
                      </Text>
                    </Flexbox>,
                    <span
                      className={stylex.props(styles.cell, styles.mono).className}
                      key={`${contender.id}-rate`}
                    >
                      {hasGap ? '—' : formatPercent(s.passRate)}
                    </span>,
                    <span
                      className={stylex.props(styles.cell, styles.mono).className}
                      key={`${contender.id}-passed`}
                    >
                      {s.passed}/{s.total}
                    </span>,
                    <span
                      className={stylex.props(styles.cell, styles.mono).className}
                      key={`${contender.id}-allk`}
                    >
                      {k > 1 ? (s.anyK === undefined ? '—' : `${s.anyK}/${s.total}`) : ''}
                    </span>,
                    <span
                      className={stylex.props(styles.cell, styles.mono).className}
                      key={`${contender.id}-cost`}
                    >
                      {formatCost(s.perCaseCost)}
                      {s.avgMinutes !== undefined &&
                        ` · ${t('lobeBench.unit.min', { value: s.avgMinutes.toFixed(1) })}`}
                    </span>,
                  ];
                })}
              </div>
            </Flexbox>
          </Block>

          {categories.length > 0 && (
            <Block
              className={stylex.props(styles.tableScroll).className}
              padding={12}
              variant={'outlined'}
            >
              <Flexbox gap={8}>
                <Flexbox gap={2}>
                  <Text weight={600}>{t('lobeBench.dashboard.byCategory')}</Text>
                  <Text fontSize={12} type={'secondary'}>
                    {t('lobeBench.dashboard.byCategory.hint')}
                  </Text>
                </Flexbox>
                <div
                  className={stylex.props(styles.grid).className}
                  style={{
                    gridTemplateColumns: `minmax(140px, 1fr) ${ranked.map(() => 'minmax(90px, 1fr)').join(' ')}`,
                    minWidth: Math.max(380, 160 + ranked.length * 120),
                  }}
                >
                  <span />
                  {ranked.map((c) => (
                    <Text
                      ellipsis
                      className={stylex.props(styles.head).className}
                      key={c.id}
                      style={{ textAlign: 'center' }}
                    >
                      {c.name.split(' · ')[0]}
                    </Text>
                  ))}
                  {categories.map((cat) => [
                    <Text
                      ellipsis
                      className={stylex.props(styles.cell).className}
                      fontSize={13}
                      key={`${cat}-label`}
                    >
                      {cat}
                    </Text>,
                    ...ranked.map((c) => {
                      const rate = categoryRate(c, cat);
                      return (
                        <div
                          className={stylex.props(styles.heat).className}
                          key={`${cat}-${c.id}`}
                          style={{ cursor: 'pointer', ...heatStyle(rate) }}
                          onClick={() => {
                            setCategory(cat);
                            setFilter('all');
                            setTab('cases');
                          }}
                        >
                          {rate === undefined ? '—' : formatPercent(rate)}
                        </div>
                      );
                    }),
                  ])}
                </div>
              </Flexbox>
            </Block>
          )}

          {levels.length > 0 && (
            <Block
              className={stylex.props(styles.tableScroll).className}
              padding={12}
              variant={'outlined'}
            >
              <Flexbox gap={8}>
                <Flexbox gap={2}>
                  <Text weight={600}>{t('lobeBench.dashboard.byLevel')}</Text>
                  <Text fontSize={12} type={'secondary'}>
                    {t('lobeBench.dashboard.byLevel.hint')}
                  </Text>
                </Flexbox>
                <div
                  className={stylex.props(styles.grid).className}
                  style={{
                    gridTemplateColumns: `minmax(140px, 1fr) ${ranked.map(() => 'minmax(90px, 1fr)').join(' ')}`,
                    minWidth: Math.max(380, 160 + ranked.length * 120),
                  }}
                >
                  <span />
                  {ranked.map((c) => (
                    <Text
                      ellipsis
                      className={stylex.props(styles.head).className}
                      key={c.id}
                      style={{ textAlign: 'center' }}
                    >
                      {c.name.split(' · ')[0]}
                    </Text>
                  ))}
                  {levels.map((item) => [
                    <Text
                      ellipsis
                      className={stylex.props(styles.cell).className}
                      fontSize={13}
                      key={`${item}-label`}
                    >
                      {t(levelLabelKey(item))}
                    </Text>,
                    ...ranked.map((c) => {
                      const rate = levelRate(c, item);
                      return (
                        <div
                          className={stylex.props(styles.heat).className}
                          key={`${item}-${c.id}`}
                          style={{ cursor: 'pointer', ...heatStyle(rate) }}
                          onClick={() => {
                            setLevel(item);
                            setFilter('all');
                            setTab('cases');
                          }}
                        >
                          {rate === undefined ? '—' : formatPercent(rate)}
                        </div>
                      );
                    }),
                  ])}
                </div>
              </Flexbox>
            </Block>
          )}
        </Flexbox>
      )}

      {tab === 'cases' && (
        <Flexbox gap={12}>
          <Flexbox horizontal align={'center'} gap={12} wrap={'wrap'}>
            <Segmented
              size={'small'}
              value={filter}
              options={[
                ...(contenders.length > 1
                  ? [{ label: t('lobeBench.dashboard.filter.diff'), value: 'diff' }]
                  : []),
                { label: t('lobeBench.dashboard.filter.all'), value: 'all' },
                { label: t('lobeBench.dashboard.filter.allFail'), value: 'allFail' },
                { label: t('lobeBench.dashboard.filter.errors'), value: 'errors' },
                { label: t('lobeBench.compare.filter.judgeErrors'), value: 'judgeErrors' },
              ]}
              onChange={(value) => setFilter(value as ExperimentCaseFilter)}
            />
            {category && (
              <Tag closable onClose={() => setCategory(undefined)}>
                {t('lobeBench.dashboard.filter.category', { category })}
              </Tag>
            )}
            {level && (
              <Tag closable onClose={() => setLevel(undefined)}>
                {t('lobeBench.dashboard.filter.level', { level: t(levelLabelKey(level)) })}
              </Tag>
            )}
            {hasFilters && (
              <Button size={'small'} type={'text'} onClick={clearFilters}>
                {t('lobeBench.dashboard.filter.clear')}
              </Button>
            )}
            <Text fontSize={12} type={'secondary'}>
              {t('lobeBench.dashboard.cases.count', { count: filteredCases.length, k })}
            </Text>
          </Flexbox>
          <Block
            className={stylex.props(styles.tableScroll).className}
            padding={8}
            variant={'outlined'}
          >
            <div
              className={stylex.props(styles.grid).className}
              style={{
                gridTemplateColumns: gridColumns,
                minWidth: Math.max(380, 260 + contenders.length * 110),
              }}
            >
              <span className={stylex.props(styles.head).className}>
                {t('lobeBench.library.col.case')}
              </span>
              {contenders.map((c) => (
                <Flexbox
                  className={stylex.props(styles.head).className}
                  key={c.id}
                  style={{ textAlign: 'center' }}
                >
                  <Text ellipsis fontSize={12}>
                    {c.name.split(' · ')[0]}
                  </Text>
                  <Text ellipsis fontSize={11} type={'secondary'}>
                    {c.name.split(' · ').slice(1).join(' · ')}
                  </Text>
                </Flexbox>
              ))}
              {filteredCases.length === 0 && (
                <Text style={{ gridColumn: '1 / -1', padding: 16 }} type={'secondary'}>
                  {t(
                    hasFilters
                      ? 'lobeBench.dashboard.cases.empty'
                      : 'lobeBench.dashboard.cases.unavailable',
                  )}
                </Text>
              )}
              {filteredCases.map((item) => (
                <ExperimentCaseRow
                  columns={gridColumns}
                  index={getCaseIndex(item)}
                  key={item.id}
                  subtitle={`${getCaseCategory(item)} · ${getCaseConnectors(item).slice(0, 3).join(' · ')}`}
                  title={getCaseTitle(item)}
                  results={contenders.map((c) => {
                    const a = attemptOf(c, item.id);
                    return {
                      id: c.id,
                      style: verdictStyle(a.verdict),
                      label: resultUnavailable(c, item.id)
                        ? t('lobeBench.dashboard.caseUnavailable')
                        : a.verdict === 'judge_error'
                          ? t('lobeBench.compare.judgeError')
                          : a.verdict === 'error' || a.verdict === 'timeout'
                            ? t('lobeBench.compare.error')
                            : a.verdict === 'pending' || a.verdict === 'running'
                              ? '…'
                              : `${a.passCount}/${a.total}`,
                    };
                  })}
                  onOpen={() => setOpenCase(item.id)}
                />
              ))}
            </div>
          </Block>
        </Flexbox>
      )}

      {tab === 'setup' && (
        <Block
          className={stylex.props(styles.tableScroll).className}
          padding={12}
          variant={'outlined'}
        >
          <Flexbox gap={8}>
            <Text fontSize={12} type={'secondary'}>
              {t('lobeBench.dashboard.setup.hint')}
            </Text>
            <div
              className={stylex.props(styles.grid).className}
              style={{
                gridTemplateColumns:
                  'minmax(0, 1.4fr) minmax(0, 1fr) minmax(0, 1fr) 90px 70px 80px 90px',
                minWidth: 720,
              }}
            >
              {[
                t('lobeBench.dashboard.col.contender'),
                t('lobeBench.dashboard.setup.col.model'),
                t('lobeBench.dashboard.setup.col.settings'),
                t('lobeBench.dashboard.setup.col.cases'),
                t('lobeBench.dashboard.setup.col.k'),
                t('lobeBench.dashboard.setup.col.steps'),
                t('lobeBench.dashboard.setup.col.cost'),
              ].map((label) => (
                <span className={stylex.props(styles.head).className} key={label}>
                  {label}
                </span>
              ))}
              {contenders.map((c) => [
                <Text
                  ellipsis
                  className={stylex.props(styles.cell).className}
                  key={`${c.id}-n`}
                  weight={500}
                >
                  {c.name}
                </Text>,
                <Text
                  ellipsis
                  className={stylex.props(styles.cell).className}
                  fontSize={12}
                  key={`${c.id}-m`}
                  type={'secondary'}
                >
                  {c.model} · {c.provider}
                </Text>,
                <Text
                  ellipsis
                  className={stylex.props(styles.cell).className}
                  fontSize={12}
                  key={`${c.id}-s`}
                  type={'secondary'}
                >
                  {settingsOf(c)}
                </Text>,
                <span
                  className={stylex.props(styles.cell, styles.mono).className}
                  key={`${c.id}-c`}
                >
                  {statsOf(c).total}
                </span>,
                <span
                  className={stylex.props(styles.cell, styles.mono).className}
                  key={`${c.id}-k`}
                >
                  {k}×
                </span>,
                <span
                  className={stylex.props(styles.cell, styles.mono).className}
                  key={`${c.id}-st`}
                >
                  {meta.maxSteps}
                </span>,
                <span
                  className={stylex.props(styles.cell, styles.mono).className}
                  key={`${c.id}-$`}
                >
                  {formatCost(statsOf(c).totalCost, 2)}
                </span>,
              ])}
            </div>
          </Flexbox>
        </Block>
      )}

      <ExperimentCaseDetails
        title={openItem ? getCaseTitle(openItem) : undefined}
        results={
          openItem
            ? contenders.map((contender) => {
                const run = runOf(contender);
                return {
                  id: contender.id,
                  name: contender.name,
                  attempt: attemptOf(contender, openItem.id),
                  unavailable: resultUnavailable(contender, openItem.id),
                  traceUrl:
                    run && benchmarkId
                      ? `/eval/bench/${benchmarkId}/runs/${run.id}/cases/${openItem.id}?experiment=${experimentId}`
                      : undefined,
                };
              })
            : []
        }
        subtitle={
          openItem
            ? `${getCaseCategory(openItem)} · ${getCaseConnectors(openItem).join(' · ')}`
            : ''
        }
        onClose={() => setOpenCase(undefined)}
      />
    </Flexbox>
  );
});

ExperimentDashboard.displayName = 'LobeBenchExperimentDashboard';

export default ExperimentDashboard;

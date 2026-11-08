'use client';

import {
  Accordion,
  ActionIcon,
  Alert,
  Block,
  Button,
  confirmModal,
  Flexbox,
  Input,
  InputNumber,
  Modal,
  Select,
  Tag,
  Text,
  toast,
} from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { Pencil, Plus, X } from 'lucide-react';
import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router';

import { useActiveWorkspaceId } from '@/business/client/hooks/useActiveWorkspaceId';
import { openContenderModal } from '@/features/LobeBench/ContenderForm';
import { readExperimentDefaults } from '@/features/LobeBench/experimentDefaults';
import {
  draftDatasetIds,
  type ExperimentDraft,
  getInvalidDraftSelections,
} from '@/features/LobeBench/experimentDraft';
import {
  createExperimentLaunch,
  type ExperimentLaunch,
  isResumableLaunch,
  type LaunchOutcome,
} from '@/features/LobeBench/experimentLaunch';
import {
  benchmarkDatasetsOf,
  benchmarkIdsOfDatasets,
  benchmarkProtocolOf,
  caseCountOf,
  datasetIdsOfBenchmarks,
  DEFAULT_MAX_STEPS,
  DEFAULT_TIMEOUT_MINUTES,
  describeSettings,
  getBenchmarkMeta,
  K_OPTIONS,
  LOBE_BENCH_KIND,
  LOBE_BENCH_PATH,
  type LobeBenchContender,
  type LobeBenchExperimentMeta,
  type LobeBenchExperimentPart,
  pickPrimaryBenchmark,
  RANK_ATTEMPTS,
  replaceContender,
  runStats,
  sameContender,
  settingsBenchmarkOf,
  sortBenchmarks,
  upsertContenders,
} from '@/features/LobeBench/lobeBench';
import { useExperimentDraft } from '@/features/LobeBench/useExperimentDraft';
import { useExperimentLaunch } from '@/features/LobeBench/useExperimentLaunch';
import {
  pickDefaultDataset,
  useLobeBenchBenchmarks,
  useLobeBenchDatasets,
  useLobeBenchRuns,
} from '@/features/LobeBench/useLobeBench';
import { useSavedContenders } from '@/features/LobeBench/useSavedContenders';
import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import { agentEvalService } from '@/services/agentEval';
import { useAiInfraStore } from '@/store/aiInfra';
import { useEvalStore } from '@/store/eval';
import { useUserStore } from '@/store/user';
import { userProfileSelectors } from '@/store/user/selectors';

import {
  forgetExperimentLaunch,
  isExperimentLaunching,
  startBackgroundLaunch,
} from '../launchBackground';
import { launchServices } from '../launchServices';

const styles = stylex.create({
  container: {
    overflowY: 'auto',
    paddingBlockStart: 56,
    paddingBlockEnd: 32,
    paddingInline: 32,
  },
  form: { width: '100%', maxWidth: 760 },
  step: {
    fontSize: 12,
    fontWeight: 500,
    color: cssVar.colorTextSecondary,
    letterSpacing: '0.02em',
  },
  // One contender per row, the same outline and radius as the page's inputs.
  row: {
    display: 'flex',
    gap: 12,
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingBlock: 10,
    paddingInline: 12,
    borderWidth: 1,
    borderStyle: 'solid',
    borderColor: cssVar.colorBorderSecondary,
    borderRadius: cssVar.borderRadius,
  },
});

const NewExperiment = memo(() => {
  const { t } = useTranslation('eval');
  const navigate = useWorkspaceAwareNavigate();
  const refreshExperiments = useEvalStore((s) => s.refreshExperiments);
  const { benchmarks } = useLobeBenchBenchmarks();
  const benchmarkIds = useMemo(() => benchmarks.map((b) => b.id), [benchmarks]);
  const { data: datasets } = useLobeBenchDatasets(benchmarkIds);
  // Past runs give a per-case price for a model the account ran before.
  const { data: pastRuns } = useLobeBenchRuns(benchmarkIds);
  // Contenders the account saved or ran before: one click adds them again.
  const { contenders: savedContenders, save: saveContenders } = useSavedContenders();

  const userId = useUserStore(userProfileSelectors.userId);
  const workspaceId = useActiveWorkspaceId();
  const enabledModels = useAiInfraStore((s) => s.enabledChatModelList);
  const modelsReady = useAiInfraStore((s) => s.isInitAiProviderRuntimeState);
  const [starting, setStarting] = useState(false);
  const [confirmationOpen, setConfirmationOpen] = useState(false);
  const [launchError, setLaunchError] = useState<string>();
  const launchInFlight = useRef(false);
  const creatingLaunch = useRef(false);
  const [searchParams, setSearchParams] = useSearchParams();
  const presetDatasetId = searchParams.get('dataset');
  const initialDataset =
    datasets?.find((item) => item.id === presetDatasetId) ||
    pickDefaultDataset(datasets, pickPrimaryBenchmark(benchmarks)?.id);
  const getInitialDraft = (benchmarkId: string): ExperimentDraft => {
    // Hard 50 runs on the library: it starts from the library benchmark's defaults.
    const benchmark = settingsBenchmarkOf(benchmarks, benchmarkId);
    const defaults = {
      ...getBenchmarkMeta(benchmark).defaults,
      ...readExperimentDefaults(benchmark?.id ?? benchmarkId),
    };
    return {
      contenders: [],
      datasetId: pickDefaultDataset(datasets, benchmarkId)?.id,
      // Three attempts by default: what a leaderboard ranks on.
      k:
        defaults?.k && K_OPTIONS.includes(defaults.k)
          ? (defaults.k as ExperimentDraft['k'])
          : (RANK_ATTEMPTS as ExperimentDraft['k']),
      maxConcurrency: null,
      maxSteps: defaults?.maxSteps ?? DEFAULT_MAX_STEPS,
      name: '',
      pickCases: false,
      pickedCaseIds: [],
      question: '',
      timeoutMinutes: defaults?.timeoutMinutes ?? DEFAULT_TIMEOUT_MINUTES,
    };
  };
  const {
    clearDraft,
    draft,
    ready: draftReady,
    restored,
    storageError,
    updateDraft,
  } = useExperimentDraft({
    benchmarkIds,
    getInitialDraft,
    initialBenchmarkId: initialDataset?.benchmarkId ?? pickPrimaryBenchmark(benchmarks)?.id,
    presetDatasetId,
    ready: !!datasets && benchmarks.length > 0,
    userId,
    workspaceId,
  });
  const currentDraft = draft ?? getInitialDraft(initialDataset?.benchmarkId ?? '');
  const { contenders, maxConcurrency, name, question } = currentDraft;
  // An experiment is started on one or more benchmarks (experiments and benchmarks
  // are n to n), never on a dataset by itself: a dataset the draft names stands for
  // its benchmark, and each chosen benchmark runs every dataset it is made of.
  const { datasetId: draftDatasetId, datasetIds: draftDatasetList } = currentDraft;
  const draftIds = draftDatasetIds({ datasetId: draftDatasetId, datasetIds: draftDatasetList });
  const { chosenBenchmarkIds, datasetIds } = useMemo(() => {
    const chosen = benchmarkIdsOfDatasets(
      datasets,
      benchmarks,
      draftDatasetIds({ datasetId: draftDatasetId, datasetIds: draftDatasetList }),
    );
    return {
      chosenBenchmarkIds: chosen,
      datasetIds: datasetIdsOfBenchmarks(datasets, benchmarks, chosen),
    };
  }, [benchmarks, datasets, draftDatasetId, draftDatasetList]);
  // A launch in progress: the experiment and run ids were fixed before the
  // first server call, so a failed start resumes against the same ids. While
  // one exists the form is locked, so a resume cannot change what is running.
  // The launch record is kept under the first dataset's benchmark.
  const launchBenchmarkId =
    (datasets?.find((d) => d.id === datasetIds[0]) ?? initialDataset)?.benchmarkId ?? undefined;
  const {
    begin: beginLaunch,
    clear: clearLaunch,
    launch,
    ready: launchReady,
  } = useExperimentLaunch({ benchmarkId: launchBenchmarkId, userId, workspaceId });
  const [outcome, setOutcome] = useState<LaunchOutcome>();
  // Providers this server cannot call for the account (no key), found by the
  // pre-start check; cleared whenever the contenders or the judge change.
  const [providerProblems, setProviderProblems] = useState<string[]>([]);
  const [checkingProviders, setCheckingProviders] = useState(false);
  const frozen = starting || !!launch;
  const setContenders = (update: (list: LobeBenchContender[]) => LobeBenchContender[]) =>
    updateDraft((value) => ({ ...value, contenders: update(value.contenders) }));
  // Renames or retunes a picked contender; one from the saved list keeps the edit for later experiments too.
  const editContender = (contender: LobeBenchContender) =>
    openContenderModal(
      (edited) => {
        setContenders((list) => replaceContender(list, edited));
        const saved = replaceContender(savedContenders, edited);
        if (saved === savedContenders) return;
        saveContenders(saved).catch((error: unknown) =>
          toast.error(error instanceof Error ? error.message : String(error)),
        );
      },
      t('lobeBench.contenders.edit'),
      t('lobeBench.contender.save.list'),
      contender,
    );
  // Only benchmarks are offered, each with the cases of all its datasets.
  const benchmarkOptions = useMemo(
    () =>
      sortBenchmarks(benchmarks).flatMap((benchmark) => {
        const madeOf = benchmarkDatasetsOf(datasets, benchmark);
        return madeOf.length > 0
          ? [{ benchmark, caseCount: madeOf.reduce((sum, d) => sum + caseCountOf(d), 0) }]
          : [];
      }),
    [benchmarks, datasets],
  );

  const selected = useMemo(
    () =>
      datasetIds.flatMap((id) => {
        const item = datasets?.find((d) => d.id === id);
        return item ? [item] : [];
      }),
    [datasetIds, datasets],
  );
  // An experiment runs whole datasets (no case picking here), one
  // part each: a run per contender on the dataset, as the Evaluation Lab runs one.
  const parts = useMemo(
    () =>
      selected.map((d) => ({
        benchmarkId: d.benchmarkId ?? undefined,
        caseCount: caseCountOf(d),
        datasetId: d.id,
      })),
    [selected],
  );
  const partsReady = parts.length > 0;
  // Every run on a benchmark is graded by the judge the benchmark was made with;
  // an experiment cannot pick its own.
  const judgeOf = (benchmarkId?: string) =>
    getBenchmarkMeta(benchmarks.find((b) => b.id === benchmarkId)).judge;
  const chosenJudges = chosenBenchmarkIds.flatMap((id) => {
    const benchmark = benchmarks.find((b) => b.id === id);
    const judge = judgeOf(id);
    return benchmark ? [{ benchmark, judge }] : [];
  });
  // Every run on a benchmark also follows the run rules (attempts per case, step
  // limit, timeout) the benchmark was made with. One experiment runs one set of
  // rules: its page, estimate and leaderboard read a single k.
  const protocolOfBenchmark = (benchmarkId?: string) =>
    benchmarkProtocolOf(benchmarks.find((b) => b.id === benchmarkId));
  const protocol = protocolOfBenchmark(chosenBenchmarkIds[0]);
  const benchmarksWithoutStandard = chosenJudges.filter(
    ({ benchmark, judge }) => !judge || !protocolOfBenchmark(benchmark.id),
  );
  const mixedRules = chosenBenchmarkIds.some((id) => {
    const rules = protocolOfBenchmark(id);
    return (
      !!rules &&
      !!protocol &&
      (rules.k !== protocol.k ||
        rules.maxSteps !== protocol.maxSteps ||
        rules.timeoutMinutes !== protocol.timeoutMinutes)
    );
  });
  const k = protocol?.k ?? 1;
  const caseCount = parts.reduce((sum, part) => sum + part.caseCount, 0);
  const attempts = caseCount * contenders.length * k;
  const availableModels = useMemo(
    () =>
      (enabledModels ?? []).flatMap((provider) =>
        (provider.children ?? []).map((model) => ({
          model: model.id,
          provider: provider.id,
          supportsTools: !!model.abilities?.functionCall,
        })),
      ),
    [enabledModels],
  );
  const invalid = draft && getInvalidDraftSelections(draft, [], availableModels);
  // A benchmark's judge must be one this account can call; it is never swapped for another.
  const judgeUnavailable = chosenJudges.some(
    ({ judge }) =>
      !!judge &&
      !availableModels.some((m) => m.model === judge.model && m.provider === judge.provider),
  );
  const missingModels = modelsReady && (!!invalid?.contenders.length || judgeUnavailable);
  const canStart =
    draftReady &&
    launchReady &&
    !launch &&
    partsReady &&
    contenders.length > 0 &&
    caseCount > 0 &&
    modelsReady &&
    !missingModels &&
    !!protocol &&
    !mixedRules &&
    benchmarksWithoutStandard.length === 0;
  // Estimate from the newest completed run of each contender's model: its
  // per-case cost times the cases and attempts this experiment will make.
  const estimate = useMemo(() => {
    let cost = 0;
    let known = 0;
    for (const contender of contenders) {
      const history = (pastRuns ?? []).find((run) => {
        const config = (run.config ?? {}) as { model?: string; provider?: string };
        return (
          run.status === 'completed' &&
          config.model === contender.model &&
          config.provider === contender.provider &&
          runStats(run).perCaseCost !== undefined
        );
      });
      if (!history) continue;
      known += 1;
      cost += runStats(history).perCaseCost! * caseCount * k;
    }
    return { cost, known };
  }, [caseCount, contenders, k, pastRuns]);
  const labels = {
    reasoning: t('lobeBench.contender.settings.reasoning'),
    temperature: t('lobeBench.contender.settings.temperature'),
    topP: t('lobeBench.contender.settings.topP'),
  };

  const providersInPlay = [
    ...new Set([
      ...contenders.map((c) => c.provider),
      ...chosenJudges.flatMap(({ judge }) => (judge?.provider ? [judge.provider] : [])),
    ]),
  ].sort();
  const providersKey = providersInPlay.join(',');
  useEffect(() => {
    setProviderProblems([]);
  }, [providersKey]);

  // Money leaves the account only after this: the one confirmation of the flow.
  // First the same provider construction a run performs: a contender whose
  // provider has no key on this server would otherwise burn every attempt on
  // `InvalidProviderAPIKey`.
  const confirmStart = async () => {
    if (!canStart || checkingProviders || starting || confirmationOpen) return;
    setCheckingProviders(true);
    let problems: string[];
    try {
      const checks = (await agentEvalService.checkProviders(providersInPlay)) ?? [];
      problems = checks.filter((check) => !check.ok).map((check) => check.provider);
    } catch {
      toast.error(t('lobeBench.new.providerCheckFailed'));
      setCheckingProviders(false);
      return;
    }
    setCheckingProviders(false);
    setProviderProblems(problems);
    if (problems.length > 0) {
      toast.error(t('lobeBench.new.providerKeyMissing', { provider: problems.join(', ') }));
      return;
    }
    setOutcome(undefined);
    setLaunchError(undefined);
    setConfirmationOpen(true);
  };

  // The parts as stored: the first also fills the one-dataset fields older readers know.
  const metaParts = (): LobeBenchExperimentPart[] =>
    parts.map(({ caseCount: _count, ...part }) => part);
  const launchMetadata = (): LobeBenchExperimentMeta => {
    const all = metaParts();
    const [first] = all;
    return {
      contenders,
      ...(first.caseIds && { caseIds: first.caseIds }),
      datasetId: first.datasetId,
      ...(all.length > 1 && { parts: all }),
      ...(first.pickedDatasetId && { pickedDatasetId: first.pickedDatasetId }),
      k: protocol!.k,
      kind: LOBE_BENCH_KIND,
      maxSteps: protocol!.maxSteps,
      ...(question.trim() && { question: question.trim() }),
      timeout: protocol!.timeoutMinutes * 60_000,
    };
  };
  const runConfigFor = (key: string, part: LobeBenchExperimentPart) => {
    const contender = contenders.find((c) => c.id === key);
    if (!contender) throw new Error(`Unknown contender ${key}`);
    // The part's benchmark rules, frozen into the run like every other parameter.
    const rules = protocolOfBenchmark(part.benchmarkId) ?? protocol!;
    return {
      ...(part.caseIds && {
        caseSelection: { caseIds: part.caseIds, mode: 'include' as const },
      }),
      ...(contender.chatConfig && { chatConfig: contender.chatConfig }),
      // The part's benchmark judge, frozen into the run like every other parameter.
      ...(judgeOf(part.benchmarkId) && {
        judgeModel: judgeOf(part.benchmarkId)!.model,
        judgeProvider: judgeOf(part.benchmarkId)!.provider,
      }),
      k: rules.k,
      ...(maxConcurrency && { maxConcurrency }),
      maxSteps: rules.maxSteps,
      model: contender.model,
      ...(contender.params && { params: contender.params }),
      provider: contender.provider,
      timeout: rules.timeoutMinutes * 60_000,
    };
  };

  // Runs (or resumes) a launch record. It reads only the record: every id and
  // every parameter was frozen when the launch began, so the draft, the case
  // set in the URL or the models available now cannot change what it sends.
  const runLaunch = async (record: ExperimentLaunch) => {
    if (launchInFlight.current || !userId) return;
    launchInFlight.current = true;
    setStarting(true);
    setConfirmationOpen(false);
    setLaunchError(undefined);
    clearDraft();
    const task = startBackgroundLaunch(
      { benchmarkId: record.benchmarkId, userId, workspaceId },
      record,
      launchServices,
    );
    navigate(`${LOBE_BENCH_PATH}/experiments/${record.experimentId}`);
    try {
      const result = await task;
      if (!result.complete) return;
      try {
        await saveContenders(upsertContenders(savedContenders, contenders));
      } catch {
        /* Optional preference save. */
      }
      await refreshExperiments().catch(() => undefined);
      await clearLaunch(record.experimentId);
    } catch {
      /* The experiment page displays the retained launch error. */
    } finally {
      launchInFlight.current = false;
      setStarting(false);
    }
  };

  const start = async () => {
    if (!canStart || creatingLaunch.current || launchInFlight.current) return;
    const all = metaParts();
    const record = createExperimentLaunch({
      benchmarkId: launchBenchmarkId ?? benchmarks[0].id,
      // Linked to every benchmark it covers: Hard 50's, the library's, the account's.
      benchmarkIds: [
        ...new Set(all.flatMap((part) => (part.benchmarkId ? [part.benchmarkId] : []))),
      ],
      // One run per contender and dataset; picked cases run on the library they come from.
      contenders: all.flatMap((part, index) =>
        contenders.map((contender) => ({
          config: runConfigFor(contender.id, part),
          datasetId: part.datasetId,
          id: contender.id,
          name: contender.name,
          ...(all.length > 1 && { part: index }),
        })),
      ),
      datasetId: all[0].datasetId,
      metadata: launchMetadata() as unknown as Record<string, unknown>,
      name: name.trim() || contenders.map((c) => c.name).join(' vs '),
    });
    // No checkpoint, no spend: a launch this browser cannot remember cannot be
    // resumed, and a launch another tab already began must not be overwritten.
    creatingLaunch.current = true;
    setStarting(true);
    try {
      const begun = await beginLaunch(record);
      if (!begun.ok) {
        if (begun.reason === 'occupied') {
          setConfirmationOpen(false);
          toast.error(t('lobeBench.new.launch.occupied'));
        } else {
          setLaunchError(t('lobeBench.new.launch.storageError'));
        }
        return;
      }
      await runLaunch(record);
    } catch (error) {
      setLaunchError(error instanceof Error ? error.message : t('lobeBench.new.error'));
    } finally {
      creatingLaunch.current = false;
      setStarting(false);
    }
  };

  const abandonLaunch = () => {
    if (!launch) return;
    if (isExperimentLaunching(launch.experimentId)) {
      toast.error(t('lobeBench.new.launch.busy'));
      return;
    }
    confirmModal({
      content: t('lobeBench.new.launch.abandon.confirm'),
      okText: t('lobeBench.new.launch.abandon'),
      onOk: async () => {
        if (isExperimentLaunching(launch.experimentId)) return;
        await clearLaunch(launch.experimentId);
        if (userId) forgetExperimentLaunch(userId, workspaceId, launch.experimentId);
        setOutcome(undefined);
      },
      title: t('lobeBench.new.launch.abandon.title'),
    });
  };
  const openLaunch = () => {
    if (launch) {
      setConfirmationOpen(false);
      navigate(`${LOBE_BENCH_PATH}/experiments/${launch.experimentId}`);
    }
  };
  const failureMessage =
    launchError ??
    (outcome?.error
      ? outcome.error.stage === 'metadata'
        ? t('lobeBench.new.launch.metadataFailed', { error: outcome.error.message })
        : t('lobeBench.new.launch.failed', {
            error: outcome.error.message,
            name: outcome.error.contender?.name ?? t('lobeBench.new.title'),
          })
      : outcome && outcome.unconfirmed.length > 0
        ? t('lobeBench.new.launch.unconfirmed', {
            count: outcome.unconfirmed.length,
            names: outcome.unconfirmed.map((c) => c.name).join(', '),
          })
        : undefined);

  return (
    <Flexbox className={stylex.props(styles.container).className} flex={1}>
      {/* createModal cannot disable Escape / the header close button in @lobehub/ui 6.15. */}
      <Modal
        closable={!starting}
        keyboard={!starting}
        maskClosable={!starting}
        open={confirmationOpen}
        footer={
          <Flexbox horizontal gap={8} justify={'flex-end'} wrap={'wrap'}>
            <Button disabled={starting} onClick={() => setConfirmationOpen(false)}>
              {t('lobeBench.new.cancel')}
            </Button>
            {outcome && (
              <Button disabled={starting} onClick={openLaunch}>
                {t('lobeBench.new.launch.open')}
              </Button>
            )}
            <Button
              disabled={starting || (!!launch && !isResumableLaunch(launch))}
              loading={starting}
              type={'primary'}
              onClick={() => (launch && isResumableLaunch(launch) ? runLaunch(launch) : start())}
            >
              {starting
                ? t('lobeBench.new.launch.title')
                : launch
                  ? outcome && !outcome.error && outcome.unconfirmed.length > 0
                    ? t('lobeBench.new.launch.recheck')
                    : t('lobeBench.new.launch.continue')
                  : t('lobeBench.new.confirm.ok')}
            </Button>
          </Flexbox>
        }
        title={
          !starting && failureMessage
            ? t('lobeBench.new.launch.interrupted')
            : t('lobeBench.new.confirm.title')
        }
        onCancel={() => {
          if (!starting) setConfirmationOpen(false);
        }}
      >
        <Flexbox gap={16}>
          {!failureMessage ? (
            <Flexbox gap={8}>
              <Text>
                {t('lobeBench.new.confirm.line', {
                  attempts,
                  cases: caseCount,
                  contenders: contenders.length,
                  k,
                })}
              </Text>
              <Text type={'secondary'}>
                {estimate.known > 0
                  ? t('lobeBench.new.confirm.cost', { cost: `$${estimate.cost.toFixed(2)}` })
                  : t('lobeBench.new.confirm.costUnknown')}
              </Text>
              <Text type={'secondary'}>
                {chosenJudges
                  .map(({ benchmark, judge }) => {
                    const rules = protocolOfBenchmark(benchmark.id);
                    return t('lobeBench.new.confirm.standardOf', {
                      benchmark: benchmark.name,
                      k: rules?.k ?? '—',
                      maxSteps: rules?.maxSteps ?? '—',
                      model: judge?.model ?? '—',
                      timeout: rules?.timeoutMinutes ?? '—',
                    });
                  })
                  .join(' · ')}
              </Text>
              <Text type={'secondary'}>{t('lobeBench.new.confirm.billing')}</Text>
            </Flexbox>
          ) : null}
          {!starting && failureMessage && <Alert title={failureMessage} type={'warning'} />}
          {outcome && !outcome.complete && (
            <Text fontSize={12}>
              {t('lobeBench.new.launch.progress', {
                started: outcome.started.length + outcome.kept.length,
                total: launch?.contenders.length ?? contenders.length,
              })}
            </Text>
          )}
        </Flexbox>
      </Modal>
      <Flexbox className={stylex.props(styles.form).className} gap={28}>
        <Flexbox gap={4}>
          <Text as={'h1'} fontSize={24} weight={600}>
            {t('lobeBench.new.title')}
          </Text>
          <Text type={'secondary'}>{t('lobeBench.new.subtitle')}</Text>
        </Flexbox>

        {restored && (
          <Flexbox horizontal align={'center'} gap={12} justify={'space-between'}>
            <Text fontSize={12} type={'secondary'}>
              {t('lobeBench.new.draft.restored')}
            </Text>
            <Button disabled={frozen} size={'small'} onClick={() => clearDraft(true)}>
              {t('lobeBench.new.draft.discard')}
            </Button>
          </Flexbox>
        )}
        {storageError && <Alert title={t('lobeBench.new.draft.storageError')} type={'warning'} />}
        {launch && (
          <Alert
            type={'warning'}
            description={
              <Flexbox gap={8}>
                <Text fontSize={12}>
                  {!isResumableLaunch(launch)
                    ? t('lobeBench.new.launch.legacy.hint')
                    : !outcome
                      ? t('lobeBench.new.launch.unknown')
                      : (failureMessage ??
                        t('lobeBench.new.launch.progress', {
                          started: outcome.started.length + outcome.kept.length,
                          total: launch.contenders.length,
                        }))}
                </Text>
                <Flexbox horizontal gap={8} wrap={'wrap'}>
                  {isResumableLaunch(launch) && (
                    <Button
                      disabled={starting}
                      loading={starting}
                      size={'small'}
                      type={'primary'}
                      onClick={() => runLaunch(launch)}
                    >
                      {outcome && !outcome.error && outcome.unconfirmed.length > 0
                        ? t('lobeBench.new.launch.recheck')
                        : t('lobeBench.new.launch.continue')}
                    </Button>
                  )}
                  <Button disabled={starting} size={'small'} onClick={openLaunch}>
                    {t('lobeBench.new.launch.open')}
                  </Button>
                  <Button disabled={starting} size={'small'} onClick={abandonLaunch}>
                    {t('lobeBench.new.launch.abandon')}
                  </Button>
                </Flexbox>
              </Flexbox>
            }
            title={
              isResumableLaunch(launch)
                ? t('lobeBench.new.launch.pending')
                : t('lobeBench.new.launch.legacy')
            }
          />
        )}
        {launchReady && !launch && benchmarks.length > 1 && (
          <Text fontSize={12} type={'secondary'}>
            {t('lobeBench.new.launch.perBenchmark')}
          </Text>
        )}

        <Flexbox gap={12}>
          <Flexbox gap={6}>
            <Text weight={500}>{t('lobeBench.new.name')}</Text>
            <Input
              disabled={!draftReady || frozen}
              placeholder={t('lobeBench.new.name.placeholder')}
              value={name}
              variant={'filled'}
              onChange={(e) => updateDraft({ name: e.target.value })}
            />
          </Flexbox>
          <Flexbox gap={6}>
            <Text weight={500}>{t('lobeBench.new.question')}</Text>
            <Input
              disabled={!draftReady || frozen}
              placeholder={t('lobeBench.new.question.placeholder')}
              value={question}
              variant={'filled'}
              onChange={(e) => updateDraft({ question: e.target.value })}
            />
          </Flexbox>
        </Flexbox>

        <Flexbox gap={10}>
          <span className={stylex.props(styles.step).className}>
            {t('lobeBench.new.step.dataset')}
          </span>
          <Select
            disabled={!draftReady || frozen}
            loading={!datasets}
            mode={'multiple'}
            value={chosenBenchmarkIds}
            variant={'filled'}
            options={benchmarkOptions.map(({ benchmark, caseCount: count }) => ({
              label: (
                <Flexbox horizontal align={'center'} gap={8}>
                  <span>{benchmark.name}</span>
                  <span style={{ color: cssVar.colorTextQuaternary, fontSize: 12 }}>
                    {t('lobeBench.new.dataset.cases', { count })}
                  </span>
                </Flexbox>
              ),
              value: benchmark.id,
            }))}
            onChange={(value) => {
              const ids = datasetIdsOfBenchmarks(datasets, benchmarks, value as string[]);
              updateDraft((current) => ({
                ...current,
                datasetId: ids[0],
                datasetIds: ids,
                pickedCaseIds: [],
              }));
              // The URL named a case set: drop it once it is no longer chosen, so
              // Back does not restore the old preset over this choice.
              if (presetDatasetId && !ids.includes(presetDatasetId)) {
                setSearchParams(
                  (params) => {
                    params.delete('dataset');
                    return params;
                  },
                  { replace: true },
                );
              }
            }}
          />
          {draftReady && datasets && draftIds.some((id) => !datasets.some((d) => d.id === id)) && (
            <Alert title={t('lobeBench.new.draft.datasetUnavailable')} type={'warning'} />
          )}
        </Flexbox>

        <Flexbox gap={10}>
          <span className={stylex.props(styles.step).className}>
            {t('lobeBench.new.step.contenders')}
          </span>
          {savedContenders.some((saved) => !contenders.some((c) => sameContender(c, saved))) && (
            <Flexbox gap={6}>
              <Text fontSize={12} type={'secondary'}>
                {t('lobeBench.new.contenders.saved')}
              </Text>
              <Flexbox horizontal gap={8} wrap={'wrap'}>
                {savedContenders
                  .filter((saved) => !contenders.some((c) => sameContender(c, saved)))
                  .map((saved) => (
                    <Button
                      disabled={!draftReady || frozen}
                      key={saved.id}
                      size={'small'}
                      onClick={() => setContenders((list) => [...list, { ...saved }])}
                    >
                      {saved.name}
                    </Button>
                  ))}
              </Flexbox>
            </Flexbox>
          )}
          <Flexbox gap={8}>
            {contenders.map((contender) => {
              const settings =
                describeSettings(contender.params, contender.chatConfig, labels) ||
                t('lobeBench.contender.settings.default');
              return (
                <div className={stylex.props(styles.row).className} key={contender.id}>
                  <Flexbox gap={2} style={{ minWidth: 0 }}>
                    <Text ellipsis weight={500}>
                      {contender.name}
                    </Text>
                    {/* The auto name already carries the settings; then show the model instead. */}
                    <Text ellipsis fontSize={12} type={'secondary'}>
                      {contender.name.includes(settings)
                        ? `${contender.model} · ${contender.provider}`
                        : `${settings} · ${contender.model} · ${contender.provider}`}
                    </Text>
                  </Flexbox>
                  <Flexbox horizontal gap={4} style={{ flex: 'none' }}>
                    <ActionIcon
                      disabled={!draftReady || frozen}
                      icon={Pencil}
                      size={'small'}
                      title={t('lobeBench.contenders.edit')}
                      onClick={() => editContender(contender)}
                    />
                    <ActionIcon
                      disabled={!draftReady || frozen}
                      icon={X}
                      size={'small'}
                      title={t('lobeBench.new.contenders.remove')}
                      onClick={() =>
                        setContenders((list) => list.filter((item) => item.id !== contender.id))
                      }
                    />
                  </Flexbox>
                </div>
              );
            })}
            <div>
              <Button
                disabled={!draftReady || frozen}
                icon={Plus}
                onClick={() =>
                  openContenderModal((contender) => setContenders((list) => [...list, contender]))
                }
              >
                {t('lobeBench.new.contenders.add')}
              </Button>
            </div>
          </Flexbox>
          <Text fontSize={12} type={'secondary'}>
            {contenders.length === 0
              ? t('lobeBench.new.contenders.empty')
              : t('lobeBench.new.contenders.hint')}
          </Text>
        </Flexbox>

        <Accordion
          defaultValue={[]}
          indicatorPlacement="inline"
          styles={{ header: { paddingBlock: 8, paddingInline: 4 } }}
          items={[
            {
              children: (
                <Flexbox gap={16} style={{ paddingTop: 8 }}>
                  <Flexbox gap={6}>
                    <Text weight={500}>{t('lobeBench.new.maxConcurrency')}</Text>
                    <Text fontSize={12} type={'secondary'}>
                      {t('lobeBench.new.maxConcurrency.hint', { count: k })}
                    </Text>
                    <InputNumber
                      disabled={!draftReady || frozen}
                      max={20}
                      min={1}
                      placeholder={t('lobeBench.new.maxConcurrency.placeholder')}
                      precision={0}
                      style={{ width: '100%' }}
                      value={maxConcurrency}
                      variant={'filled'}
                      onChange={(value) => updateDraft({ maxConcurrency: value as number | null })}
                    />
                  </Flexbox>
                </Flexbox>
              ),
              key: 'advanced',
              title: t('lobeBench.new.advanced'),
            },
          ]}
        />

        {missingModels && (
          <Alert title={t('lobeBench.new.draft.modelsUnavailable')} type={'warning'} />
        )}
        {benchmarksWithoutStandard.length > 0 && (
          <Alert
            type={'error'}
            title={t('lobeBench.new.standard.missing', {
              name: benchmarksWithoutStandard.map(({ benchmark }) => benchmark.name).join(', '),
            })}
          />
        )}
        {mixedRules && <Alert title={t('lobeBench.new.standard.mixed')} type={'error'} />}
        {providerProblems.length > 0 && (
          <Alert
            title={t('lobeBench.new.providerKeyMissing', { provider: providerProblems.join(', ') })}
            type={'error'}
          />
        )}

        <Block padding={16} variant={'outlined'}>
          <Flexbox horizontal align={'center'} gap={16} justify={'space-between'} wrap={'wrap'}>
            <Flexbox gap={2} style={{ minWidth: 0 }}>
              <Flexbox horizontal align={'center'} gap={8}>
                <Tag>{attempts}</Tag>
                <Text fontSize={12} type={'secondary'}>
                  {t('lobeBench.new.estimate', { attempts })}
                </Text>
              </Flexbox>
            </Flexbox>
            <Flexbox horizontal gap={8}>
              <Button disabled={starting} onClick={() => navigate(LOBE_BENCH_PATH)}>
                {t('lobeBench.new.cancel')}
              </Button>
              <Button
                disabled={!canStart || starting}
                loading={starting || checkingProviders}
                type={'primary'}
                onClick={confirmStart}
              >
                {t('lobeBench.new.start')}
              </Button>
            </Flexbox>
          </Flexbox>
        </Block>
      </Flexbox>
    </Flexbox>
  );
});

NewExperiment.displayName = 'LobeBenchNewExperiment';

export default NewExperiment;

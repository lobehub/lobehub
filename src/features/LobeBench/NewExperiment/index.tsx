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
  Segmented,
  Select,
  Tag,
  Text,
  toast,
} from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { Plus, X } from 'lucide-react';
import { memo, useEffect, useMemo, useState } from 'react';
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
  launchExperiment,
  type LaunchOutcome,
} from '@/features/LobeBench/experimentLaunch';
import {
  caseCountOf,
  DEFAULT_MAX_STEPS,
  DEFAULT_TIMEOUT_MINUTES,
  describeSettings,
  getBenchmarkMeta,
  isCustomDataset,
  K_OPTIONS,
  LOBE_BENCH_KIND,
  LOBE_BENCH_PATH,
  type LobeBenchContender,
  type LobeBenchExperimentMeta,
  type LobeBenchExperimentPart,
  orderDatasetsForPicker,
  pickPrimaryBenchmark,
  RANK_ATTEMPTS,
  rankableSetsOf,
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
import ModelSelect from '@/features/ModelSelect';
import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import { agentEvalService } from '@/services/agentEval';
import { useAiInfraStore } from '@/store/aiInfra';
import { useEvalStore } from '@/store/eval';
import { useUserStore } from '@/store/user';
import { userProfileSelectors } from '@/store/user/selectors';

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
  const [searchParams, setSearchParams] = useSearchParams();
  const presetDatasetId = searchParams.get('dataset');
  const initialDataset =
    datasets?.find((item) => item.id === presetDatasetId) ||
    pickDefaultDataset(datasets, pickPrimaryBenchmark(benchmarks)?.id);
  const primaryMeta = getBenchmarkMeta(pickPrimaryBenchmark(benchmarks));
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
  const { contenders, judge, k, maxSteps, name, question, timeoutMinutes } = currentDraft;
  // One or more datasets: experiments and benchmarks are n to n.
  const datasetIds = draftDatasetIds(currentDraft);
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
    resume: resumeLaunch,
  } = useExperimentLaunch({ benchmarkId: launchBenchmarkId, userId, workspaceId });
  const [outcome, setOutcome] = useState<LaunchOutcome>();
  // Providers this server cannot call for the account (no key), found by the
  // pre-start check; cleared whenever the contenders or the judge change.
  const [providerProblems, setProviderProblems] = useState<string[]>([]);
  const [checkingProviders, setCheckingProviders] = useState(false);
  const frozen = starting || !!launch;
  const setContenders = (update: (list: LobeBenchContender[]) => LobeBenchContender[]) =>
    updateDraft((value) => ({ ...value, contenders: update(value.contenders) }));
  const datasetOptions = useMemo(
    () => orderDatasetsForPicker(datasets, benchmarks),
    [benchmarks, datasets],
  );
  // A dataset a benchmark is made of is offered as that benchmark (with the dataset's
  // name when the benchmark has several); the rest are the account's loose datasets.
  const benchmarkNames = useMemo(
    () => new Map(rankableSetsOf(sortBenchmarks(benchmarks), datasets).map((s) => [s.id, s.name])),
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
  const missingModels = modelsReady && (!!invalid?.contenders.length || !!invalid?.judge);
  const canStart =
    draftReady &&
    launchReady &&
    !launch &&
    partsReady &&
    contenders.length > 0 &&
    caseCount > 0 &&
    modelsReady &&
    !missingModels;
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

  const providersInPlay = useMemo(
    () =>
      [
        ...new Set([
          ...contenders.map((c) => c.provider),
          ...((judge ?? primaryMeta.judge)?.provider
            ? [(judge ?? primaryMeta.judge)!.provider]
            : []),
        ]),
      ].sort(),
    [contenders, judge, primaryMeta.judge],
  );
  const providersKey = providersInPlay.join(',');
  useEffect(() => {
    setProviderProblems([]);
  }, [providersKey]);

  // Money leaves the account only after this: the one confirmation of the flow.
  // First the same provider construction a run performs: a contender whose
  // provider has no key on this server would otherwise burn every attempt on
  // `InvalidProviderAPIKey`.
  const confirmStart = async () => {
    if (!canStart || checkingProviders) return;
    setCheckingProviders(true);
    let problems: string[];
    try {
      const checks = await agentEvalService.checkProviders(providersInPlay);
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
    confirmModal({
      content: (
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
            {(judge ?? primaryMeta.judge)
              ? t('lobeBench.new.confirm.judge', { model: (judge ?? primaryMeta.judge)!.model })
              : t('lobeBench.new.confirm.judgeDefault')}
          </Text>
          <Text type={'secondary'}>{t('lobeBench.new.confirm.billing')}</Text>
        </Flexbox>
      ),
      okText: t('lobeBench.new.confirm.ok'),
      onOk: start,
      title: t('lobeBench.new.confirm.title'),
    });
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
      k,
      kind: LOBE_BENCH_KIND,
      maxSteps: maxSteps ?? DEFAULT_MAX_STEPS,
      ...(question.trim() && { question: question.trim() }),
      timeout: (timeoutMinutes ?? DEFAULT_TIMEOUT_MINUTES) * 60_000,
    };
  };
  const runConfigFor = (key: string, part: LobeBenchExperimentPart) => {
    const contender = contenders.find((c) => c.id === key);
    if (!contender) throw new Error(`Unknown contender ${key}`);
    return {
      ...(part.caseIds && {
        caseSelection: { caseIds: part.caseIds, mode: 'include' as const },
      }),
      ...(contender.chatConfig && { chatConfig: contender.chatConfig }),
      ...(judge && { judgeModel: judge.model, judgeProvider: judge.provider }),
      k,
      maxSteps: maxSteps ?? DEFAULT_MAX_STEPS,
      model: contender.model,
      ...(contender.params && { params: contender.params }),
      provider: contender.provider,
      timeout: (timeoutMinutes ?? DEFAULT_TIMEOUT_MINUTES) * 60_000,
    };
  };

  const launchServices = {
    createExperiment: (params: Parameters<typeof agentEvalService.createExperiment>[0]) =>
      agentEvalService.createExperiment(params),
    createRun: (params: {
      config: Record<string, unknown>;
      datasetId: string;
      experimentId: string;
      id: string;
      name: string;
    }) => agentEvalService.createRun(params as Parameters<typeof agentEvalService.createRun>[0]),
    listRuns: async (experimentId: string) => {
      const response = (await agentEvalService.listRuns({ experimentId })) as {
        data?: Array<{ id: string; status?: string | null }>;
      };
      return response?.data ?? [];
    },
    startRun: (runId: string) => agentEvalService.startRun(runId),
    updateExperiment: (params: { id: string; metadata: Record<string, unknown> }) =>
      agentEvalService.updateExperiment(params),
  };

  // Runs (or resumes) a launch record. It reads only the record: every id and
  // every parameter was frozen when the launch began, so the draft, the case
  // set in the URL or the models available now cannot change what it sends.
  const runLaunch = async (record: ExperimentLaunch) => {
    setStarting(true);
    try {
      // One resume at a time for this launch: a second tab (or a double click)
      // is told it is busy instead of reading `idle` too and starting again.
      const exclusive = await resumeLaunch(record.experimentId, () =>
        launchExperiment(record, launchServices),
      );
      if (!exclusive.ran) {
        toast.error(t('lobeBench.new.launch.occupied'));
        return;
      }
      const result = exclusive.result;
      setOutcome(result);
      if (!result.complete) {
        if (result.error) {
          toast.error(
            result.error.stage === 'metadata'
              ? t('lobeBench.new.launch.metadataFailed', { error: result.error.message })
              : t('lobeBench.new.launch.failed', {
                  error: result.error.message,
                  name: result.error.contender?.name ?? t('lobeBench.new.title'),
                }),
          );
        }
        return;
      }
      // Remember the contenders for the next experiment; a failure here must
      // not stop the experiment.
      try {
        await saveContenders(upsertContenders(savedContenders, contenders));
      } catch {
        /* the experiment still runs */
      }
      // The experiment exists whether or not the list refresh succeeds; the
      // dashboard loads it by id.
      await refreshExperiments().catch(() => undefined);
      await clearLaunch(record.experimentId);
      clearDraft();
      navigate(`${LOBE_BENCH_PATH}/experiments/${record.experimentId}`);
    } catch (error) {
      toast.error(
        error instanceof Error && error.message ? error.message : t('lobeBench.new.error'),
      );
    } finally {
      setStarting(false);
    }
  };

  const start = async () => {
    if (!canStart) return;
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
    const begun = await beginLaunch(record);
    if (!begun.ok) {
      toast.error(
        begun.reason === 'occupied'
          ? t('lobeBench.new.launch.occupied')
          : t('lobeBench.new.launch.storageError'),
      );
      return;
    }
    await runLaunch(record);
  };

  const abandonLaunch = () => {
    if (!launch) return;
    confirmModal({
      content: t('lobeBench.new.launch.abandon.confirm'),
      okText: t('lobeBench.new.launch.abandon'),
      onOk: async () => {
        await clearLaunch(launch.experimentId);
        setOutcome(undefined);
      },
      title: t('lobeBench.new.launch.abandon.title'),
    });
  };
  const openLaunch = () => {
    if (launch) navigate(`${LOBE_BENCH_PATH}/experiments/${launch.experimentId}`);
  };

  return (
    <Flexbox className={stylex.props(styles.container).className} flex={1}>
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
                      : outcome.error?.stage === 'metadata'
                        ? t('lobeBench.new.launch.metadataFailed', { error: outcome.error.message })
                        : outcome.unconfirmed.length > 0 && !outcome.error
                          ? t('lobeBench.new.launch.unconfirmed', {
                              count: outcome.unconfirmed.length,
                              names: outcome.unconfirmed.map((c) => c.name).join(', '),
                            })
                          : t('lobeBench.new.launch.progress', {
                              started: outcome.started.length + outcome.kept.length,
                              total: launch.contenders.length,
                            })}
                </Text>
                <Flexbox horizontal gap={8} wrap={'wrap'}>
                  {isResumableLaunch(launch) && (
                    <Button
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
            value={datasetIds}
            variant={'filled'}
            options={[
              // The benchmarks (the whole library, Hard 50, the account's), then the
              // account's datasets in no benchmark.
              {
                label: t('lobeBench.new.group.benchmarks'),
                options: datasetOptions.filter(
                  (d) => benchmarkNames.has(d.id) || !isCustomDataset(d),
                ),
              },
              {
                label: t('lobeBench.new.group.datasets'),
                options: datasetOptions.filter(
                  (d) => !benchmarkNames.has(d.id) && isCustomDataset(d),
                ),
              },
            ]
              .filter((group) => group.options.length > 0)
              .map((group) => ({
                label: group.label,
                options: group.options.map((d) => ({
                  label: (
                    <Flexbox horizontal align={'center'} gap={8}>
                      <span>{benchmarkNames.get(d.id) ?? d.name}</span>
                      <span style={{ color: cssVar.colorTextQuaternary, fontSize: 12 }}>
                        {t('lobeBench.new.dataset.cases', { count: caseCountOf(d) })}
                      </span>
                    </Flexbox>
                  ),
                  value: d.id,
                })),
              }))}
            onChange={(value) => {
              const ids = value as string[];
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
          {draftReady && datasets && selected.length < datasetIds.length && (
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
                  <ActionIcon
                    disabled={!draftReady || frozen}
                    icon={X}
                    size={'small'}
                    style={{ flex: 'none' }}
                    title={t('lobeBench.new.contenders.remove')}
                    onClick={() =>
                      setContenders((list) => list.filter((item) => item.id !== contender.id))
                    }
                  />
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

        <Flexbox gap={10}>
          <span className={stylex.props(styles.step).className}>{t('lobeBench.new.step.k')}</span>
          <Segmented
            disabled={!draftReady || frozen}
            value={String(k)}
            options={K_OPTIONS.map((option) => ({
              label:
                option === 1
                  ? t('lobeBench.new.k.once')
                  : option === RANK_ATTEMPTS
                    ? t('lobeBench.new.k.ranked', { k: option })
                    : t('lobeBench.new.k.times', { k: option }),
              value: String(option),
            }))}
            onChange={(value) => updateDraft({ k: Number(value) as ExperimentDraft['k'] })}
          />
          <Text fontSize={12} type={'secondary'}>
            {t('lobeBench.new.k.hint', { k: RANK_ATTEMPTS })}
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
                    <Text weight={500}>{t('lobeBench.new.maxSteps')}</Text>
                    <InputNumber
                      disabled={!draftReady || frozen}
                      max={1000}
                      min={1}
                      style={{ width: '100%' }}
                      value={maxSteps}
                      variant={'filled'}
                      onChange={(value) => updateDraft({ maxSteps: value as number | null })}
                    />
                  </Flexbox>
                  <Flexbox gap={6}>
                    <Text weight={500}>{t('lobeBench.new.timeout')}</Text>
                    <InputNumber
                      disabled={!draftReady || frozen}
                      max={240}
                      min={1}
                      style={{ width: '100%' }}
                      value={timeoutMinutes}
                      variant={'filled'}
                      onChange={(value) => updateDraft({ timeoutMinutes: value as number | null })}
                    />
                  </Flexbox>
                  <Flexbox gap={6}>
                    <Text weight={500}>{t('lobeBench.new.judge')}</Text>
                    <Text fontSize={12} type={'secondary'}>
                      {t('lobeBench.new.judge.hint')}
                    </Text>
                    <ModelSelect
                      allowClear
                      disabled={!draftReady || frozen}
                      value={judge}
                      variant={'filled'}
                      placeholder={
                        primaryMeta.judge
                          ? t('lobeBench.new.confirm.judge', { model: primaryMeta.judge.model })
                          : t('lobeBench.new.confirm.judgeDefault')
                      }
                      onChange={(value) => updateDraft({ judge: value })}
                      onClear={() => updateDraft({ judge: undefined })}
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
              <Button onClick={() => navigate(LOBE_BENCH_PATH)}>{t('lobeBench.new.cancel')}</Button>
              <Button
                disabled={!canStart}
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

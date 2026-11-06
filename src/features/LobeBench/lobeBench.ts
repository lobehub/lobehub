import {
  type AgentEvalRunListItem,
  evalCaseVersionOf,
  type EvalRunChatConfig,
  type EvalRunModelParams,
} from '@lobechat/types';

import { LOBE_BENCH_KIND } from '@/store/eval/kinds';

export {
  CASE_LEVELS,
  type CaseLevel,
  getCaseDifficulty,
  getCaseLevel,
  levelLabelKey,
  levelTagColor,
} from '@/features/Eval/caseDifficulty';

/** `agent_eval_benchmarks.metadata.kind` / `agent_eval_experiments.metadata.kind` of Lobe Bench rows. */
export { LOBE_BENCH_KIND };
export const LOBE_BENCH_PATH = '/eval/lobe-bench';
export const DEFAULT_MAX_STEPS = 30;
export const DEFAULT_TIMEOUT_MINUTES = 20;
export const K_OPTIONS = [1, 2, 3, 4, 5];
/**
 * Attempts per case a leaderboard ranks on: a case counts
 * when it passes all of them. Runs of more attempts rank on their estimate for
 * this many; runs of fewer are not ranked.
 */
export const RANK_ATTEMPTS = 3;

/**
 * A contender is a model plus the settings it runs with; the same model with
 * another setting is a different contender. One experiment run per contender.
 */
export interface LobeBenchContender {
  chatConfig?: EvalRunChatConfig;
  id: string;
  model: string;
  name: string;
  params?: EvalRunModelParams;
  provider: string;
  /** Filled in once the experiment started. */
  runId?: string;
}

/**
 * One dataset an experiment ran, in the benchmark it is part of. An experiment can
 * cover several benchmarks (experiments and benchmarks are n to n),
 * one part each; every contender has a run on every part.
 */
export interface LobeBenchExperimentPart {
  /** The benchmark the dataset is part of. */
  benchmarkId?: string;
  /** Dataset-native ids of the cases run, when the part ran some of the dataset's cases. */
  caseIds?: string[];
  /** The dataset the runs are on. */
  datasetId: string;
  /**
   * Experiments from before datasets held their cases (until 2026-10-31): the
   * dataset whose case ids were run on the library.
   */
  pickedDatasetId?: string;
  /** Each contender's run on this part, by contender id, once the runs exist. */
  runIds?: Record<string, string>;
}

/** What Lobe Bench stores in `agent_eval_experiments.metadata`. */
export interface LobeBenchExperimentMeta {
  /** Dataset-native ids of the cases the experiment ran; absent when it ran the whole set. */
  caseIds?: string[];
  contenders: LobeBenchContender[];
  datasetId: string;
  k: number;
  kind: typeof LOBE_BENCH_KIND;
  maxSteps: number;
  /**
   * Every dataset the experiment ran, when it covers more than one. The fields
   * above (`datasetId`, `caseIds`, `pickedDatasetId`, each contender's `runId`)
   * then repeat the first part, for readers that know one dataset.
   */
  parts?: LobeBenchExperimentPart[];
  /**
   * Experiments from before datasets held their cases (until 2026-10-31): the
   * dataset whose case ids were run on the library.
   */
  pickedDatasetId?: string;
  question?: string;
  timeout: number;
}

type Metadata = Record<string, unknown> | null | undefined;

/** What the Settings page keeps in `agent_eval_benchmarks.metadata` (beside `kind` and `mock`). */
export interface LobeBenchBenchmarkMeta {
  /** Contenders the account saved or ran before, offered again on the next experiment. */
  contenders?: LobeBenchContender[];
  /** What a new experiment starts with. */
  defaults?: { k?: number; maxSteps?: number; timeoutMinutes?: number };
  /** The judge every attempt is graded with unless a case set or case names its own. */
  judge?: { model: string; provider: string };
  kind?: string;
  /** Mock-side dataset segment and timeout; the address is server configuration, never stored here. */
  mock?: { dataset?: string; timeoutMs?: number };
  /**
   * A benchmark made of library cases (Hard 50): the engine view (frozen Pack Release)
   * it was seeded from. Its runs are on the library, so the library's benchmark holds
   * their judge, mock and defaults.
   */
  view?: { id: string; manifestSha256?: string; version: string };
}

export const getBenchmarkMeta = (benchmark?: { metadata?: Metadata } | null) =>
  (benchmark?.metadata ?? {}) as LobeBenchBenchmarkMeta;

/** A benchmark made of library cases (Hard 50), as opposed to the library's own benchmark. */
export const isViewBenchmark = (benchmark?: { metadata?: Metadata } | null) =>
  !!getBenchmarkMeta(benchmark).view;

/** JSON with object keys in one order and unset fields left out, so equal settings give equal text. */
export const stableJson = (value: unknown) =>
  JSON.stringify(value, (_key, item) =>
    item && typeof item === 'object' && !Array.isArray(item)
      ? Object.fromEntries(
          Object.entries(item as Record<string, unknown>)
            .filter(([, field]) => field !== undefined)
            .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
        )
      : item,
  );

/** Two contenders are the same when their model and settings match, whatever the name. */
export const sameContender = (a: LobeBenchContender, b: LobeBenchContender) =>
  a.model === b.model &&
  a.provider === b.provider &&
  stableJson(a.params ?? {}) === stableJson(b.params ?? {}) &&
  stableJson(a.chatConfig ?? {}) === stableJson(b.chatConfig ?? {});

/** The saved list with these contenders added or refreshed (matched by id, then by setup). */
export const upsertContenders = (
  saved: LobeBenchContender[] | undefined,
  added: LobeBenchContender[],
): LobeBenchContender[] => {
  const list = [...(saved ?? [])];
  for (const contender of added) {
    const { runId: _runId, ...entry } = contender;
    const index = list.findIndex((item) => item.id === entry.id || sameContender(item, entry));
    if (index === -1) list.push(entry);
    // The same setup again keeps its saved id and name; an explicit edit
    // (same id) takes the new values.
    else if (list[index].id === entry.id) list[index] = { ...list[index], ...entry };
  }
  return list;
};

/** The datasets an experiment ran: its parts, or the one dataset an older experiment names. */
export const experimentPartsOf = (meta: LobeBenchExperimentMeta): LobeBenchExperimentPart[] =>
  meta.parts?.length
    ? meta.parts
    : [
        {
          caseIds: meta.caseIds,
          datasetId: meta.datasetId,
          pickedDatasetId: meta.pickedDatasetId,
          runIds: Object.fromEntries(
            meta.contenders.flatMap((c) => (c.runId ? [[c.id, c.runId] as const] : [])),
          ),
        },
      ];

/** The experiment as one of its parts: that dataset, its cases and each contender's run on it. */
export const experimentPartMeta = <T extends LobeBenchExperimentMeta>(
  meta: T,
  part: LobeBenchExperimentPart,
): T => ({
  ...meta,
  caseIds: part.caseIds,
  contenders: meta.contenders.map((contender) => ({
    ...contender,
    runId: part.runIds?.[contender.id],
  })),
  datasetId: part.datasetId,
  pickedDatasetId: part.pickedDatasetId,
});

export const isLobeBenchMeta = (
  metadata: Metadata,
): metadata is LobeBenchExperimentMeta & Record<string, unknown> =>
  !!metadata && metadata.kind === LOBE_BENCH_KIND && Array.isArray(metadata.contenders);

export const isLobeBenchBenchmark = (benchmark: { metadata?: Metadata }) =>
  benchmark.metadata?.kind === LOBE_BENCH_KIND;

export const isRunActive = (status?: string | null) => status === 'pending' || status === 'running';

/**
 * The model settings a contender can carry: what the chat model-params panel
 * offers (per the model's `settings.extendParams`) and a run's chatConfig
 * accepts, in the order their labels read.
 */
export const CONTENDER_SETTING_KEYS = [
  'enableReasoning',
  'enableAdaptiveThinking',
  'reasoningEffort',
  'gpt5ReasoningEffort',
  'gpt5_1ReasoningEffort',
  'gpt5_2ReasoningEffort',
  'gpt5_2ProReasoningEffort',
  'gpt5_6ReasoningEffort',
  'gpt6ReasoningEffort',
  'codexMaxReasoningEffort',
  'deepseekV4ReasoningEffort',
  'deepseekV4GAReasoningEffort',
  'glm5_2ReasoningEffort',
  'glm5_3ReasoningEffort',
  'grok4_3ReasoningEffort',
  'grok4_5ReasoningEffort',
  'grok4_6ReasoningEffort',
  'grok4_7ReasoningEffort',
  'grok4_20ReasoningEffort',
  'hy3ReasoningEffort',
  'kimiK3ReasoningEffort',
  'qwen38ReasoningEffort',
  'ring2_6ReasoningEffort',
  'step3_5ReasoningEffort',
  'effort',
  'opus47Effort',
  'reasoningMode',
  'reasoningBudgetToken',
  'reasoningBudgetToken32k',
  'reasoningBudgetToken80k',
  'thinking',
  'thinkingLevel',
  'thinkingLevel2',
  'thinkingLevel3',
  'thinkingLevel4',
  'thinkingBudget',
  'preserveThinking',
  'textVerbosity',
  'disableContextCaching',
] as const satisfies readonly (keyof EvalRunChatConfig)[];

/** Human-readable settings of a contender, e.g. "temperature 0.2 · reasoning high". */
export const describeSettings = (
  params?: EvalRunModelParams,
  chatConfig?: EvalRunChatConfig,
  labels?: { reasoning: string; temperature: string; topP: string },
) => {
  const parts: string[] = [];
  if (params?.temperature !== undefined)
    parts.push(`${labels?.temperature ?? 'temperature'} ${params.temperature}`);
  if (params?.top_p !== undefined) parts.push(`${labels?.topP ?? 'top_p'} ${params.top_p}`);
  if (params?.frequency_penalty !== undefined)
    parts.push(`frequency penalty ${params.frequency_penalty}`);
  if (params?.presence_penalty !== undefined)
    parts.push(`presence penalty ${params.presence_penalty}`);
  // Every setting a contender is told apart by shows, so two contenders of one
  // model never carry the same default name.
  const reasoning = labels?.reasoning ?? 'reasoning';
  for (const key of CONTENDER_SETTING_KEYS) {
    const value = chatConfig?.[key];
    if (value === undefined || value === null) continue;
    if (key === 'enableReasoning') parts.push(`${reasoning} ${value ? 'on' : 'off'}`);
    else if (key === 'enableAdaptiveThinking')
      parts.push(`adaptive thinking ${value ? 'on' : 'off'}`);
    else if (key === 'disableContextCaching') {
      if (value) parts.push('context caching off');
    } else if (key === 'preserveThinking') parts.push(`keep thinking ${value ? 'on' : 'off'}`);
    else if (/effort$/i.test(key)) parts.push(`${reasoning} ${value}`);
    else if (key.startsWith('reasoningBudgetToken')) parts.push(`reasoning budget ${value}`);
    else if (key === 'reasoningMode') parts.push(`${reasoning} mode ${value}`);
    else if (key.startsWith('thinkingLevel')) parts.push(`thinking level ${value}`);
    else if (key === 'thinkingBudget') parts.push(`thinking budget ${value}`);
    else if (key === 'thinking') parts.push(`thinking ${value}`);
    else if (key === 'textVerbosity') parts.push(`verbosity ${value}`);
  }
  return parts.join(' · ');
};

export const unwrapList = <T>(response: unknown): T[] => {
  if (Array.isArray(response)) return response as T[];
  const data = (response as { data?: unknown } | null)?.data;
  return Array.isArray(data) ? (data as T[]) : [];
};

// ---------- cases ----------

interface CaseLike {
  content?: {
    category?: string | null;
    environment?: {
      agent?: { plugins?: string[]; systemRole?: string };
      memory?: unknown;
      mock?: { services?: string[] };
      sessionDate?: string;
      timezone?: string;
      toolForwarding?: Record<string, unknown>;
    };
    input?: string;
  } | null;
  evalConfig?: { judgePrompt?: string } | null;
  id: string;
  metadata?: Record<string, unknown> | null;
  sortOrder?: number | null;
}

export const getCaseTitle = (testCase: CaseLike) => {
  const title = testCase.metadata?.title;
  if (typeof title === 'string' && title.trim()) return title.trim();
  const firstLine = (testCase.content?.input ?? '').split('\n')[0].trim();
  return firstLine.length > 80 ? `${firstLine.slice(0, 79)}…` : firstLine || testCase.id;
};

export const getCaseCategory = (testCase: CaseLike, fallback = 'Other') => {
  const category = testCase.metadata?.category ?? testCase.content?.category;
  return typeof category === 'string' && category.trim() ? category.trim() : fallback;
};

export const getCaseIndex = (testCase: CaseLike) => {
  const index = testCase.metadata?.index;
  if (typeof index === 'number') return index;
  return (testCase.sortOrder ?? 0) + 1;
};

/** Connectors the case runs against the mock (declared services, or the explicit forwarding table). */
export const getCaseConnectors = (testCase: CaseLike): string[] => {
  const environment = testCase.content?.environment;
  const services = environment?.mock?.services ?? Object.keys(environment?.toolForwarding ?? {});
  return services.filter((id) => !['lobe-creds', 'lobe-skill-store', 'lobe-skills'].includes(id));
};

export const getCaseRules = (testCase: CaseLike): string[] =>
  (testCase.evalConfig?.judgePrompt ?? '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

export {
  type AttemptVerdict,
  type CaseAttempt,
  formatCost,
  summarizeCaseResult,
} from '@/features/LobeBench/caseResults';

// ---------- runs ----------

export interface RunStats {
  active: boolean;
  /** Cases that passed every attempt (pass^k). Equals `passed` when k = 1. */
  allK?: number;
  /** Cases that passed at least one attempt (pass@k). Equals `passed` when k = 1. */
  anyK?: number;
  avgMinutes?: number;
  completed: number;
  errors: number;
  failed: number;
  /** Attempts per case the run made. */
  k: number;
  passed: number;
  passRate: number;
  perCaseCost?: number;
  total: number;
  totalCost?: number;
}

const num = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) ? value : undefined;

/**
 * A run's headline numbers. With several attempts per case (k > 1) the pass
 * rate counts a case only when every attempt passed (pass^k): the server's
 * `passedCases` is pass@k (any attempt), which is kept as `anyK` for the
 * secondary column.
 */
export const runStats = (run: AgentEvalRunListItem | undefined, totalCases?: number): RunStats => {
  const metrics = (run?.metrics ?? {}) as Record<string, unknown>;
  const k = num((run?.config as { k?: unknown } | null | undefined)?.k) ?? 1;
  const total = num(metrics.totalCases) ?? totalCases ?? 0;
  const anyK = num(metrics.passedCases) ?? 0;
  const allKRatio = num(metrics.passAllK);
  const allK = k > 1 ? (allKRatio === undefined ? undefined : Math.round(allKRatio * total)) : anyK;
  const passed = k > 1 ? (allK ?? 0) : anyK;
  const failed = num(metrics.failedCases) ?? 0;
  const errors = num(metrics.errorCases) ?? 0;
  const completed = num(metrics.completedCases) ?? anyK + failed + errors;
  const totalDuration = num(metrics.totalDuration);
  return {
    active: isRunActive(run?.status),
    allK,
    anyK,
    avgMinutes: totalDuration && completed ? totalDuration / completed / 60_000 : undefined,
    completed,
    errors,
    failed,
    k,
    passRate: total ? passed / total : 0,
    passed,
    perCaseCost: num(metrics.perCaseCost),
    total,
    totalCost: num(metrics.totalCost) ?? num(metrics.cost),
  };
};

export const formatPercent = (value: number) => `${Math.round(value * 100)}%`;

// ---- The case library and datasets ------------------------------------------
//
// Lobe Bench follows the Evaluation Lab: a dataset holds its cases and a run
// runs a dataset. The built-in case library is the dataset
// "All cases" of the "Lobe Bench" benchmark. Hard 50 and the account's datasets
// hold copies of library cases (`metadata.source = 'library'`), checked in the
// library when the dataset is made and fixed from then on, so the runs on a
// dataset stay true to it. A benchmark is made of datasets: a built-in one of
// its published datasets, one the account made of the datasets moved into it.

export interface LobeBenchDatasetMeta {
  /** The account's own dataset, kept apart from the built-in library. */
  custom?: boolean;
  kind?: string;
  /** How the bench engine renders the cases' tool results (part of their version). */
  presentation?: string;
  /** Provenance of a published set, e.g. the benchmark release it was imported from. */
  release?: string;
  /** A built-in dataset of library cases (Hard 50): the engine view (frozen Pack Release) it was seeded from. */
  view?: { id: string; manifestSha256?: string; version: string };
}

interface DatasetLike {
  benchmarkId?: string | null;
  createdAt?: Date | string | null;
  id: string;
  metadata?: Record<string, unknown> | null;
  name?: string;
  testCaseCount?: number | null;
}

export const PRIMARY_BENCHMARK_IDENTIFIER = 'lobe-bench';

export const getDatasetMeta = (dataset: DatasetLike): LobeBenchDatasetMeta =>
  (dataset.metadata ?? {}) as LobeBenchDatasetMeta;

export const isCustomDataset = (dataset: DatasetLike) => getDatasetMeta(dataset).custom === true;

/** A built-in dataset of library cases seeded from an engine view (Hard 50), not the library itself. */
export const isViewDataset = (dataset?: DatasetLike | null) =>
  !!dataset && !!getDatasetMeta(dataset).view;

/** How many cases a dataset runs: the cases it holds. */
export const caseCountOf = (dataset?: DatasetLike | null) => dataset?.testCaseCount ?? 0;

/** Built-in rows (the product's own case sets, environments) belong to no account: everyone reads them, nobody edits them. */
export const isBuiltInRow = (row?: { userId?: string | null } | null) =>
  !!row && row.userId == null;

/** The built-in benchmark: its judge, mock service and defaults are set by whoever installed it. */
export const isBuiltInBenchmark = (benchmark?: { isSystem?: boolean } | null) =>
  benchmark?.isSystem === true;

/** A benchmark the account made out of its own datasets. */
export const isCustomBenchmark = (benchmark?: { isSystem?: boolean } | null) =>
  !!benchmark && !isBuiltInBenchmark(benchmark);

const createdTime = (dataset: DatasetLike) =>
  dataset.createdAt ? new Date(dataset.createdAt).getTime() : 0;

/** The case sets of one benchmark (or of all): published sets in creation order, the account's own sets last. */
export const datasetsOf = <T extends DatasetLike>(datasets?: T[], benchmarkId?: string): T[] =>
  (datasets ?? [])
    .filter((d) => !benchmarkId || d.benchmarkId === benchmarkId)
    .sort((a, b) => {
      const ca = isCustomDataset(a) ? 1 : 0;
      const cb = isCustomDataset(b) ? 1 : 0;
      return ca - cb || createdTime(a) - createdTime(b);
    });

/** The account's own case sets under one benchmark (or all). */
export const customDatasetsOf = <T extends DatasetLike>(
  datasets?: T[],
  benchmarkId?: string,
): T[] => datasetsOf(datasets, benchmarkId).filter(isCustomDataset);

/** The built-in case library: the published dataset every library case comes from (in one benchmark, or in any). */
export const libraryOf = <T extends DatasetLike>(datasets?: T[], benchmarkId?: string) =>
  datasetsOf(datasets, benchmarkId).find((d) => !isCustomDataset(d) && !isViewDataset(d));

/**
 * The datasets a benchmark is made of: a built-in benchmark's published datasets
 * (the account's datasets filed under it are in no benchmark), or every dataset
 * in a benchmark the account made.
 */
export const benchmarkDatasetsOf = <T extends DatasetLike>(
  datasets: T[] | undefined,
  benchmark: { id: string; isSystem?: boolean },
) =>
  datasetsOf(datasets, benchmark.id).filter(
    (d) => isCustomBenchmark(benchmark) || !isCustomDataset(d),
  );

/** The account's datasets in no benchmark it made: the ones it can put into one. */
export const looseDatasetsOf = <T extends DatasetLike>(
  datasets: T[] | undefined,
  benchmarks: Array<{ id: string; isSystem?: boolean }>,
) =>
  customDatasetsOf(datasets).filter(
    (d) => !isCustomBenchmark(benchmarks.find((b) => b.id === d.benchmarkId)),
  );

/**
 * What a benchmark's leaderboard ranks: one dataset it is made of, from the
 * runs on all of its cases.
 */
export interface RankableSet {
  /** The benchmark whose leaderboard this is. */
  benchmarkId: string;
  /** The current version of the dataset's cases; only runs on it rank. */
  caseVersion?: string;
  /** The dataset ranked on. */
  id: string;
  /** The benchmark's name, with the dataset's when the benchmark has several. */
  name: string;
}

/** One leaderboard per dataset a benchmark is made of, in the order the benchmarks are given. */
export const rankableSetsOf = <T extends DatasetLike>(
  benchmarks: Array<{ id: string; isSystem?: boolean; name: string }>,
  datasets: T[] | undefined,
): RankableSet[] =>
  benchmarks.flatMap((benchmark) => {
    const madeOf = benchmarkDatasetsOf(datasets, benchmark);
    return madeOf.map((dataset) => ({
      benchmarkId: benchmark.id,
      caseVersion: evalCaseVersionOf(dataset.metadata),
      id: dataset.id,
      name: madeOf.length > 1 ? `${benchmark.name} · ${dataset.name ?? ''}` : benchmark.name,
    }));
  });

/** The set the overview ranks on and a new experiment starts from: the case library, else the first set. */
export const pickDefaultDataset = <T extends DatasetLike>(
  datasets?: T[],
  benchmarkId?: string,
): T | undefined => libraryOf(datasets, benchmarkId) ?? datasetsOf(datasets, benchmarkId)[0];

/** The benchmark Lobe Bench is about when several carry its kind. */
export const pickPrimaryBenchmark = <T extends { id: string; identifier?: string | null }>(
  benchmarks: T[],
): T | undefined =>
  benchmarks.find((b) => b.identifier === PRIMARY_BENCHMARK_IDENTIFIER) ?? benchmarks[0];

/**
 * Benchmarks in the order Lobe Bench lists them: the library's own first, the
 * other built-in ones next, then the account's; each group by age.
 */
export const sortBenchmarks = <
  T extends {
    createdAt?: Date | string | null;
    id: string;
    identifier?: string | null;
    isSystem?: boolean;
  },
>(
  benchmarks: T[],
): T[] => {
  // Only the real one: a list without it keeps age order instead of promoting its first row.
  const primary = benchmarks.find((b) => b.identifier === PRIMARY_BENCHMARK_IDENTIFIER);
  const rank = (b: T) => (b.id === primary?.id ? 0 : isBuiltInBenchmark(b) ? 1 : 2);
  const time = (b: T) => (b.createdAt ? new Date(b.createdAt).getTime() : 0);
  return [...benchmarks].sort((a, b) => rank(a) - rank(b) || time(a) - time(b));
};

/**
 * The benchmark whose settings (judge, mock, experiment defaults) apply to a
 * benchmark's runs: its own, or for one made of library cases (Hard 50, the
 * account's) the library's.
 */
export const settingsBenchmarkOf = <
  T extends { id: string; identifier?: string | null; isSystem?: boolean; metadata?: Metadata },
>(
  benchmarks: T[],
  benchmarkId?: string,
): T | undefined => {
  const benchmark = benchmarks.find((b) => b.id === benchmarkId);
  return benchmark && !isViewBenchmark(benchmark) && !isCustomBenchmark(benchmark)
    ? benchmark
    : pickPrimaryBenchmark(benchmarks);
};

/** Case sets for a picker: per benchmark (primary first), published sets then the account's own. */
export const orderDatasetsForPicker = <T extends DatasetLike>(
  datasets: T[] | undefined,
  benchmarks: Array<{ createdAt?: Date | string | null; id: string; identifier?: string | null }>,
): T[] => {
  // Primary first, then by age: the order the sidebar lists the benchmarks in.
  return sortBenchmarks(benchmarks).flatMap((benchmark) => datasetsOf(datasets, benchmark.id));
};

// ---- Case selection --------------------------------------------------------

interface SelectableCase {
  id: string;
  metadata?: Record<string, unknown> | null;
}

/** The id a run selects a case by: its dataset-native `metadata.caseId`, else its primary key. */
export const nativeCaseId = (testCase: SelectableCase) => {
  const caseId = testCase.metadata?.caseId;
  return typeof caseId === 'string' && caseId ? caseId : testCase.id;
};

interface SelectableRun {
  config?: { caseSelection?: { caseIds?: string[]; mode?: string } | null } | null;
}

/** A run on the whole case set, as opposed to one that picked some cases. Only these rank. */
export const isFullRun = (run: SelectableRun) => {
  const selection = run.config?.caseSelection;
  return !selection || selection.mode === 'all' || !(selection.caseIds?.length ?? 0);
};

/** Whether a run counts for a leaderboard set: a run on that dataset, of all its cases. */
export const runCoversSet = (
  run: SelectableRun & { datasetId?: string | null },
  set: Pick<RankableSet, 'id'>,
) => run.datasetId === set.id && isFullRun(run);

/** The version of the cases a run was made on (recorded by the server at creation). */
export const runCaseVersion = (run: SelectableRun) =>
  (run.config as { caseVersion?: unknown } | null | undefined)?.caseVersion;

/**
 * Whether a run was made on the set's current case version. Cases are edited in
 * place, so a run on an earlier version (or one from before runs recorded it) is
 * history, not a result on these cases.
 */
export const isRunOnCaseVersion = (run: SelectableRun, set: Pick<RankableSet, 'caseVersion'>) =>
  !set.caseVersion || runCaseVersion(run) === set.caseVersion;

/** How many of the set's cases the run covers. */
export const runCaseCount = (run: SelectableRun, datasetCaseCount: number) => {
  const selection = run.config?.caseSelection;
  if (!selection || selection.mode === 'all') return datasetCaseCount;
  const picked = selection.caseIds?.length ?? 0;
  return selection.mode === 'include' ? picked : Math.max(datasetCaseCount - picked, 0);
};

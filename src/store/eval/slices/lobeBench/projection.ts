import type {
  AgentEvalDatasetListItem,
  AgentEvalRunListItem,
  AgentEvalRunTopicResult,
  EvalCaseEnvironment,
} from '@lobechat/types';

import { defineReplica } from '@/libs/replica';

/** One case of a Lobe Bench dataset, as the case list returns it. */
export interface LobeBenchCase {
  content?: Record<string, any> | null;
  /** The shared environment the case runs in, when it has one. */
  environment?: { id: string; name: string } | null;
  environmentId?: string | null;
  /** The case's own environment fields, laid over the shared environment (present with one). */
  environmentOverrides?: Record<string, any>;
  evalConfig?: Record<string, any> | null;
  evalMode?: string | null;
  id: string;
  metadata?: Record<string, unknown> | null;
  sortOrder?: number | null;
}

/** A reusable case environment, as `listEnvironments` returns it. */
export interface EvalEnvironmentRow {
  config: EvalCaseEnvironment;
  description?: string | null;
  id: string;
  identifier?: string | null;
  metadata?: Record<string, unknown> | null;
  name: string;
  testCaseCount?: number;
  /** Null for a built-in environment (one of the product's own case sets). */
  userId?: string | null;
}

/** Per-case results of several runs, keyed by run id. */
export type RunResultsByRun = Record<string, AgentEvalRunTopicResult[]>;
/** Every case of several datasets, keyed by dataset id. */
export type CasesByDataset = Record<string, LobeBenchCase[]>;

/** Order-free entry key of a set of ids; the empty set has a key of its own. */
export const idSetKey = (ids: readonly string[]): string =>
  ids.length === 0 ? '-' : [...ids].sort().join(',');

/**
 * Lists keyed by a set of ids grow one persisted row per combination the user
 * ever opened; keep the recent ones, since a combination changes only when a
 * benchmark or run is added.
 */
const ID_SET_ROWS = 20;

/**
 * Case sets of the Lobe Bench benchmarks plus the standalone imported ones,
 * newest first (`lobeBenchDatasetListMap[idSetKey(benchmarkIds)]`).
 */
export const lobeBenchDatasetListResource = defineReplica<
  { benchmarkIds: string[] },
  AgentEvalDatasetListItem[]
>({
  key: ({ benchmarkIds }) => idSetKey(benchmarkIds),
  name: 'lobeBenchDatasetList',
  persist: { maxEntries: ID_SET_ROWS },
  storage: 'indexedDB',
  version: 1,
});

/** Every run under the Lobe Bench benchmarks, newest first (`lobeBenchRunListMap`). */
export const lobeBenchRunListResource = defineReplica<
  { benchmarkIds: string[] },
  AgentEvalRunListItem[]
>({
  key: ({ benchmarkIds }) => idSetKey(benchmarkIds),
  name: 'lobeBenchRunList',
  persist: { maxEntries: ID_SET_ROWS },
  storage: 'indexedDB',
  version: 1,
});

/** The runs of one experiment, one per contender (`experimentRunListMap[experimentId]`). */
export const experimentRunListResource = defineReplica<string, AgentEvalRunListItem[]>({
  key: (experimentId) => experimentId,
  name: 'lobeBenchExperimentRunList',
  persist: { maxEntries: ID_SET_ROWS },
  storage: 'indexedDB',
  version: 1,
});

/**
 * Per-case results of an experiment's runs (`runResultsByRunMap[idSetKey(runIds)]`).
 * Memory only: the set changes as runs are retried, and each run's results are
 * already persisted by `evalRunResults`.
 */
export const runResultsByRunResource = defineReplica<string[], RunResultsByRun>({
  key: idSetKey,
  name: 'lobeBenchRunResultsByRun',
  storage: 'memory',
  version: 1,
});

/** All cases of one dataset, in benchmark order (`datasetCaseListMap[datasetId]`). */
export const datasetCaseListResource = defineReplica<string, LobeBenchCase[]>({
  key: (datasetId) => datasetId,
  name: 'lobeBenchDatasetCaseList',
  persist: { maxEntries: ID_SET_ROWS },
  storage: 'indexedDB',
  version: 1,
});

/**
 * All cases of several datasets (`casesByDatasetMap[idSetKey(datasetIds)]`).
 * Memory only: the library view derives memberships from it once per visit.
 */
export const casesByDatasetResource = defineReplica<string[], CasesByDataset>({
  key: idSetKey,
  name: 'lobeBenchCasesByDataset',
  storage: 'memory',
  version: 1,
});

/** Entry key of the scope-wide environment list. */
export const ENVIRONMENT_LIST_KEY = 'all';

/** The scope-wide list takes no params; a literal keeps `useSync` enabled (`null` disables it). */
export const ENVIRONMENT_LIST_PARAMS = {} as Record<string, never>;

/** Reusable case environments of the active scope (`environmentListMap.all`). */
export const environmentListResource = defineReplica<Record<string, never>, EvalEnvironmentRow[]>({
  key: () => ENVIRONMENT_LIST_KEY,
  name: 'lobeBenchEnvironmentList',
  storage: 'indexedDB',
  version: 1,
});

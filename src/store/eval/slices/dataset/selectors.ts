import type { AgentEvalDatasetListItem } from '@lobechat/types';

import { isLobeBenchKind } from '@/store/eval/kinds';
import type { EvalStore } from '@/store/eval/store';

import { ALL_DATASETS_KEY } from './projection';

/** Stable empty array so a selector never returns a fresh reference on every read. */
const EMPTY_DATASETS: AgentEvalDatasetListItem[] = [];

/**
 * Datasets of one benchmark. The scope-wide list is read through
 * `useFetchAllDatasets` / {@link datasetSelectors.allDatasets}.
 */
const datasetList = (benchmarkId?: string) => (s: EvalStore) =>
  (benchmarkId ? s.datasetListMap[benchmarkId] : undefined) ?? EMPTY_DATASETS;

/** Every dataset of the active scope (the scope-wide list entry). */
const allDatasets = (s: EvalStore) => s.datasetListMap[ALL_DATASETS_KEY] ?? EMPTY_DATASETS;

/**
 * The Evaluation Lab's datasets: the scope-wide list without the datasets of
 * Lobe Bench benchmarks. Needs the benchmark list loaded to know which those are.
 */
const agentDatasets = (s: EvalStore) => {
  const hidden = new Set(s.benchmarkList.filter((b) => isLobeBenchKind(b)).map((b) => b.id));
  const datasets = allDatasets(s);
  return hidden.size === 0
    ? datasets
    : datasets.filter((dataset) => !dataset.benchmarkId || !hidden.has(dataset.benchmarkId));
};

/**
 * The benchmark list has no local copy yet (`undefined` is the loading
 * signal) — the sidebar / datasets tab keep their skeleton until the first paint.
 */
const isLoadingDatasetList = (benchmarkId?: string) => (s: EvalStore) =>
  !!benchmarkId && s.datasetListMap[benchmarkId] === undefined;

const getDatasetById = (id: string) => (s: EvalStore) => s.datasetDetailMap[id];

export const datasetSelectors = {
  agentDatasets,
  allDatasets,
  datasetList,
  getDatasetById,
  isLoadingDatasetList,
};

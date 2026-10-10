import type { AgentEvalDatasetListItem } from '@lobechat/types';

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
 * The benchmark list has no local copy yet (`undefined` is the loading
 * signal) — the sidebar / datasets tab keep their skeleton until the first paint.
 */
const isLoadingDatasetList = (benchmarkId?: string) => (s: EvalStore) =>
  !!benchmarkId && s.datasetListMap[benchmarkId] === undefined;

const getDatasetById = (id: string) => (s: EvalStore) => s.datasetDetailMap[id];

export const datasetSelectors = {
  allDatasets,
  datasetList,
  getDatasetById,
  isLoadingDatasetList,
};

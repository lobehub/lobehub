import type { AgentEvalDataset, AgentEvalDatasetListItem } from '@lobechat/types';

import { defineReplica } from '@/libs/replica';
import type { agentEvalService } from '@/services/agentEval';

/** The server returns the dataset list rows directly (no `{ data }` wrapper). */
type DatasetListResponse = Awaited<ReturnType<typeof agentEvalService.listDatasets>>;
/** `getDataset` returns the dataset row plus its `testCases`; the view keeps the row. */
type DatasetDetailResponse = Awaited<ReturnType<typeof agentEvalService.getDataset>>;

/** Entry key of the scope-wide list, beside every benchmark id. */
export const ALL_DATASETS_KEY = 'all';

/**
 * Datasets keyed by scope (`datasetListMap[benchmarkId | 'all']`): one entry per
 * benchmark, plus one scope-wide entry. Both come from the same `listDatasets`
 * query with different filters, so they share a single replica instead of two.
 */
export const datasetListResource = defineReplica<
  { benchmarkId?: string },
  AgentEvalDatasetListItem[],
  DatasetListResponse
>({
  key: ({ benchmarkId }) => benchmarkId ?? ALL_DATASETS_KEY,
  name: 'evalDatasetList',
  storage: 'indexedDB',
  version: 1,
});

/** One dataset page, keyed by the route param (`datasetDetailMap[id]`). */
export const datasetDetailResource = defineReplica<string, AgentEvalDataset, DatasetDetailResponse>(
  {
    key: (id) => id,
    name: 'evalDatasetDetail',
    storage: 'indexedDB',
    version: 1,
  },
);

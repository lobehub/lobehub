import type {
  AgentEvalRunDetail,
  AgentEvalRunListItem,
  AgentEvalRunResults,
} from '@lobechat/types';

import { defineReplica } from '@/libs/replica';
import type { agentEvalService } from '@/services/agentEval';

type ListRunsResponse = Awaited<ReturnType<typeof agentEvalService.listRuns>>;
/**
 * The server's `getRunDetails` payload is wider than the `AgentEvalRunDetail`
 * contract (its nested dataset keeps a nullable `benchmarkId`). The view still
 * exposes `AgentEvalRunDetail`; the engine folds the response in as-is.
 */
type RunDetailResponse = Awaited<ReturnType<typeof agentEvalService.getRunDetails>>;

/**
 * Benchmark-level run list, one entry per benchmark (`runListMap[benchmarkId]`).
 * The single `listRuns` endpoint serves both this and the dataset-scoped list,
 * but they render in different places, so each gets its own entry key.
 */
export const benchmarkRunListResource = defineReplica<
  { benchmarkId: string },
  AgentEvalRunListItem[],
  ListRunsResponse
>({
  key: ({ benchmarkId }) => benchmarkId,
  name: 'evalBenchmarkRunList',
  storage: 'indexedDB',
  version: 1,
});

/** Dataset-scoped run list, one entry per dataset (`datasetRunListMap[datasetId]`). */
export const datasetRunListResource = defineReplica<
  { datasetId: string },
  AgentEvalRunListItem[],
  ListRunsResponse
>({
  key: ({ datasetId }) => datasetId,
  name: 'evalDatasetRunList',
  storage: 'indexedDB',
  version: 1,
});

/** By-id run detail cache (`runDetailMap[runId]`). */
export const runDetailResource = defineReplica<string, AgentEvalRunDetail, RunDetailResponse>({
  key: (runId) => runId,
  name: 'evalRunDetail',
  storage: 'indexedDB',
  version: 1,
});

/** By-id run results cache (`runResultsMap[runId]`). */
export const runResultsResource = defineReplica<string, AgentEvalRunResults, AgentEvalRunResults>({
  key: (runId) => runId,
  name: 'evalRunResults',
  storage: 'indexedDB',
  version: 1,
});

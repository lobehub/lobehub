import type {
  AgentEvalRunDetail,
  AgentEvalRunListItem,
  AgentEvalRunResults,
} from '@lobechat/types';

export interface RunSliceState {
  /**
   * Map of run lists keyed by datasetId
   * Caches dataset-scoped run lists for multiple dataset detail pages
   */
  datasetRunListMap: Record<string, AgentEvalRunListItem[]>;
  isCreatingRun: boolean;
  isLoadingRuns: boolean;
  loadingRunDetailIds: string[];
  loadingRunResultIds: string[];
  runDetailMap: Record<string, AgentEvalRunDetail>;
  /**
   * Benchmark-level run list (all runs, used by sidebar and benchmark detail)
   */
  runList: AgentEvalRunListItem[];
  runResultsMap: Record<string, AgentEvalRunResults>;
}

export const runInitialState: RunSliceState = {
  datasetRunListMap: {},
  isCreatingRun: false,
  isLoadingRuns: true,
  loadingRunDetailIds: [],
  loadingRunResultIds: [],
  runDetailMap: {},
  runList: [],
  runResultsMap: {},
};

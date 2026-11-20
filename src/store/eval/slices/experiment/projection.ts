import type { AgentEvalExperimentDetail, AgentEvalExperimentListItem } from '@lobechat/types';

import { defineReplica } from '@/libs/replica';
import type { agentEvalService } from '@/services/agentEval';

/** The server wraps both experiment payloads in `{ data, success }`. */
type ExperimentListResponse = Awaited<ReturnType<typeof agentEvalService.listExperiments>>;
type ExperimentDetailResponse = Awaited<ReturnType<typeof agentEvalService.getExperiment>>;

/**
 * The experiment list has one entry per cache scope: it takes no query params,
 * so the overview, the sidebar and the header switcher all read the same list.
 */
export const EXPERIMENT_LIST_KEY = 'all';

/** Every experiment of the active scope (the flat `experimentList` view). */
export const experimentListResource = defineReplica<
  Record<string, never>,
  AgentEvalExperimentListItem[],
  ExperimentListResponse
>({
  key: () => EXPERIMENT_LIST_KEY,
  name: 'evalExperimentList',
  storage: 'indexedDB',
  version: 1,
});

/** One experiment page, keyed by the route param (`experimentDetailMap[id]`). */
export const experimentDetailResource = defineReplica<
  string,
  AgentEvalExperimentDetail,
  ExperimentDetailResponse
>({
  key: (id) => id,
  name: 'evalExperimentDetail',
  storage: 'indexedDB',
  version: 1,
});

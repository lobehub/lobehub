import type { AgentEvalRunItem } from '@/database/schemas';

import type { EvalRunResponse } from '../types/eval.type';

export const projectRun = (run: AgentEvalRunItem): EvalRunResponse => ({
  config: {
    k: run.config?.k ?? 1,
    maxSteps: run.config?.maxSteps,
    timeout: run.config?.timeout,
    maxConcurrency: run.config?.maxConcurrency,
    caseSelection: run.config?.caseSelection,
  },
  executionMode: run.config?.executionMode ?? 'internal',
  experimentId: run.experimentId,
  parentRunId: run.parentRunId,
  createdAt: run.createdAt,
  datasetId: run.datasetId,
  id: run.id,
  metrics: run.metrics,
  name: run.name,
  startedAt: run.startedAt,
  status: run.status,
  targetAgentId: run.targetAgentId,
  updatedAt: run.updatedAt,
});

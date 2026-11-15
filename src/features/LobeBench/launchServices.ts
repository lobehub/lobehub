import { agentEvalService } from '@/services/agentEval';

export const launchServices = {
  createExperiment: (params: Parameters<typeof agentEvalService.createExperiment>[0]) =>
    agentEvalService.createExperiment(params),
  createRun: (params: {
    config: Record<string, unknown>;
    datasetId: string;
    experimentId: string;
    id: string;
    name: string;
  }) => agentEvalService.createRun(params as Parameters<typeof agentEvalService.createRun>[0]),
  listRuns: (experimentId: string) => agentEvalService.listAllRuns({ experimentId }),
  startRun: (runId: string) => agentEvalService.startRun(runId),
  updateExperiment: (params: { id: string; metadata: Record<string, unknown> }) =>
    agentEvalService.updateExperiment(params),
};

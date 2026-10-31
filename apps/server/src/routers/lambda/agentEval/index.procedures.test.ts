// @vitest-environment node
import { describe, expect, it } from 'vitest';

import { agentEvalRouter } from './index';

/**
 * Pins the router's public surface: every procedure path, its kind, and its
 * middleware chain length (which encodes the procedure builder and its input
 * parsers). Splitting the router across files must keep all three.
 */
describe('agentEvalRouter procedures', () => {
  const procedures = (agentEvalRouter as any)._def.procedures as Record<string, any>;

  it('exposes exactly the expected procedure paths', () => {
    expect(Object.keys(procedures).sort()).toEqual(expected().map(([name]) => name));
  });

  it.each(expected())('%s is a %s with %i middlewares', (name, type, middlewares) => {
    expect(procedures[name]._def.type).toBe(type);
    expect(procedures[name]._def.middlewares).toHaveLength(middlewares);
  });
});

function expected(): Array<
  [name: string, type: 'mutation' | 'query' | 'subscription', middlewares: number]
> {
  return [
    ['abortRun', 'mutation', 13],
    ['batchCreateTestCases', 'mutation', 13],
    ['batchResumeRunCases', 'mutation', 13],
    ['checkBenchmarkMock', 'query', 12],
    ['checkProviders', 'query', 12],
    ['createBenchmark', 'mutation', 13],
    ['createDataset', 'mutation', 13],
    ['createEnvironment', 'mutation', 13],
    ['createExperiment', 'mutation', 13],
    ['createRun', 'mutation', 13],
    ['createTestCase', 'mutation', 13],
    ['deleteBenchmark', 'mutation', 13],
    ['deleteDataset', 'mutation', 13],
    ['deleteEnvironment', 'mutation', 13],
    ['deleteExperiment', 'mutation', 13],
    ['deleteRun', 'mutation', 13],
    ['deleteTestCase', 'mutation', 13],
    ['draftTestCaseFromTopic', 'mutation', 13],
    ['getBenchmark', 'query', 12],
    ['getDataset', 'query', 12],
    ['getEnvironment', 'query', 12],
    ['getExperiment', 'query', 12],
    ['getResumableCases', 'query', 12],
    ['getRunDetails', 'query', 12],
    ['getRunProgress', 'query', 12],
    ['getRunResults', 'query', 12],
    ['getTestCase', 'query', 12],
    ['importDataset', 'mutation', 13],
    ['listBenchmarks', 'query', 12],
    ['listDatasets', 'query', 12],
    ['listEnvironments', 'query', 11],
    ['listExperiments', 'query', 11],
    ['listRuns', 'query', 12],
    ['listTestCases', 'query', 12],
    ['parseDatasetFile', 'mutation', 13],
    ['rejudgeRun', 'mutation', 13],
    ['rerunRunUnverified', 'mutation', 13],
    ['resumeRunCase', 'mutation', 13],
    ['retryRunCase', 'mutation', 13],
    ['retryRunErrors', 'mutation', 13],
    ['startRun', 'mutation', 13],
    ['updateBenchmark', 'mutation', 13],
    ['updateDataset', 'mutation', 13],
    ['updateEnvironment', 'mutation', 13],
    ['updateExperiment', 'mutation', 13],
    ['updateRun', 'mutation', 13],
    ['updateRunMetrics', 'mutation', 13],
    ['updateRunStatus', 'mutation', 13],
    ['updateTestCase', 'mutation', 13],
  ];
}

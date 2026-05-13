import type { WorkflowContext } from '@upstash/workflow';
import debug from 'debug';

import { AgentEvalRunModel, AgentEvalTestCaseModel } from '@/database/models/agentEval';
import { getServerDB } from '@/database/server';
import { AgentEvalRunWorkflow, type RunBenchmarkPayload } from '@/server/workflows/agentEvalRun';

const log = debug('lobe-server:workflows:run-benchmark');

export const runBenchmarkWorkflowConfig = {
  flowControl: { key: 'agent-eval-run.process-run', parallelism: 100, rate: 1 },
};

export const runBenchmarkWorkflowHandler = async (
  context: WorkflowContext<RunBenchmarkPayload>,
) => {
  const { dryRun, force, runId, userId } = context.requestPayload ?? {};

  log('Starting: runId=%s dryRun=%s force=%s', runId, dryRun, force);

  if (!runId || !userId) {
    return { error: 'Missing runId or userId in payload', success: false };
  }

  const db = await getServerDB();
  const runModel = new AgentEvalRunModel(db, userId);

  const run = await context.run('agent-eval-run:get-run', () => runModel.findById(runId));

  if (!run) {
    return { error: 'Run not found', success: false };
  }

  if (run.status === 'running' && !force) {
    return { error: 'Run is already running', success: false };
  }

  const testCaseModel = new AgentEvalTestCaseModel(db, userId);
  const allTestCases = await context.run('agent-eval-run:get-test-cases', () =>
    testCaseModel.findByDatasetId(run.datasetId),
  );

  const allTestCaseIds = allTestCases.map((testCase: { id: string }) => testCase.id);

  log('Total test cases: %d', allTestCaseIds.length);

  if (allTestCaseIds.length === 0) {
    return {
      error: 'No test cases in dataset',
      success: false,
      totalTestCases: 0,
    };
  }

  const testCaseIds = await context.run('agent-eval-run:filter-existing', () =>
    AgentEvalRunWorkflow.filterTestCasesNeedingExecution(db, {
      runId,
      testCaseIds: allTestCaseIds,
      userId,
    }),
  );

  const result = {
    alreadyExecuted: allTestCaseIds.length - testCaseIds.length,
    runId,
    success: true,
    toExecute: testCaseIds.length,
    totalTestCases: allTestCaseIds.length,
  };

  log('Check result: %O', result);

  if (dryRun) {
    console.info('[run-benchmark] Dry run: %d test cases would execute', testCaseIds.length);
    return {
      ...result,
      dryRun: true,
      message: `[DryRun] Would execute ${testCaseIds.length} test cases`,
    };
  }

  if (testCaseIds.length === 0) {
    console.info('[run-benchmark] All test cases already executed for run %s', runId);
    return {
      ...result,
      message: 'All test cases already executed',
    };
  }

  await context.run('agent-eval-run:update-status', () =>
    runModel.update(runId, {
      metrics: {
        averageScore: 0,
        failedCases: 0,
        passRate: 0,
        passedCases: 0,
        totalCases: allTestCaseIds.length,
      },
      startedAt: new Date(),
      status: 'running',
    }),
  );

  log('Triggering paginate-test-cases for run %s', runId);
  await context.run('agent-eval-run:trigger-paginate', () =>
    AgentEvalRunWorkflow.triggerPaginateTestCases({ runId, userId }),
  );

  return {
    ...result,
    message: `Triggered pagination for ${testCaseIds.length} test cases`,
  };
};

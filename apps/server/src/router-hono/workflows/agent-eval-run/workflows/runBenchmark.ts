import { type WorkflowContext } from '@upstash/workflow';
import debug from 'debug';

import {
  AgentEvalRunModel,
  AgentEvalRunTopicModel,
  AgentEvalTestCaseModel,
} from '@/database/models/agentEval';
import { getServerDB } from '@/database/server';
import { selectCases } from '@/server/services/agentEvalRun/caseSelection';
import { runProgressOf } from '@/server/services/agentEvalRun/progress';
import { AgentEvalRunWorkflow, type RunBenchmarkPayload } from '@/server/workflows/agentEvalRun';
import { resolveAgentEvalRunWorkspace } from '@/server/workflows/agentEvalRun/utils';
import { runStep } from '@/server/workflows/step';

const log = debug('lobe-server:workflows:run-benchmark');

/**
 * Run benchmark workflow - entry point for agent eval run execution
 * 1. Check run status and get all test cases
 * 2. Filter test cases that already have RunTopics
 * 3. If dryRun, return statistics only
 * 4. If no test cases need execution, return early
 * 5. Update run status to 'running'
 * 6. Trigger paginate-test-cases workflow
 */
export const runBenchmarkHandler = async (context: WorkflowContext<RunBenchmarkPayload>) => {
  const { runId, dryRun, force, userId } = context.requestPayload ?? {};

  log('Starting: runId=%s dryRun=%s force=%s', runId, dryRun, force);

  if (!runId || !userId) {
    return { error: 'Missing runId or userId in payload', success: false };
  }

  const db = await getServerDB();
  const wsId = await resolveAgentEvalRunWorkspace(db, runId);
  const runModel = new AgentEvalRunModel(db, userId, wsId);

  // Get run info
  const run = await runStep(context, 'agent-eval-run:get-run', async () => {
    const row = await runModel.findSummaryById(runId);
    return row
      ? {
          config: {
            caseSelection: row.config?.caseSelection,
            executionMode: row.config?.executionMode,
          },
          datasetId: row.datasetId,
          startedAt: row.startedAt,
          status: row.status,
        }
      : undefined;
  });

  if (!run) {
    return { error: 'Run not found', success: false };
  }

  // Check run status
  if (run.status === 'running' && !force) {
    return { error: 'Run is already running', success: false };
  }

  // The run's cases: the dataset narrowed by `config.caseSelection`, the same
  // rule createRun pre-created the run's topics with. Counting the whole
  // dataset here would set a `totalCases` a partial run can never reach, so
  // it would stay `running` after its last case finished.
  const testCaseModel = new AgentEvalTestCaseModel(db, userId, wsId);
  const allTestCases = await runStep(
    context,
    'agent-eval-run:get-test-cases',
    async (): Promise<Array<string | { id: string }>> =>
      selectCases(
        await testCaseModel.findByDatasetId(run.datasetId),
        run.config?.caseSelection,
      ).map((testCase) => testCase.id),
  );

  // Existing durable checkpoints contain full case objects; new ones contain only IDs.
  const allTestCaseIds = allTestCases.map((testCase) =>
    typeof testCase === 'string' ? testCase : testCase.id,
  );

  log('Total test cases: %d', allTestCaseIds.length);

  if (allTestCaseIds.length === 0) {
    if (!dryRun && run.config?.executionMode !== 'external') {
      await runStep(context, 'agent-eval-run:fail-empty-selection', async () => {
        await runModel.finalize(runId, { status: 'failed' }, { startedAt: run.startedAt });
      });
    }
    return {
      error: 'No test cases selected for this run',
      success: false,
      totalTestCases: 0,
    };
  }

  // Filter test cases that need execution
  const testCaseIds = await runStep(context, 'agent-eval-run:filter-existing', () =>
    AgentEvalRunWorkflow.filterTestCasesNeedingExecution(db, {
      runId,
      testCaseIds: allTestCaseIds,
      userId,
      workspaceId: wsId,
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

  // If dryRun mode, return statistics only
  if (dryRun) {
    console.info('[run-benchmark] Dry run: %d test cases would execute', testCaseIds.length);
    return {
      ...result,
      dryRun: true,
      message: `[DryRun] Would execute ${testCaseIds.length} test cases`,
    };
  }

  // If no test cases need execution, return early
  if (testCaseIds.length === 0) {
    console.info('[run-benchmark] All test cases already executed for run %s', runId);
    return {
      ...result,
      message: 'All test cases already executed',
    };
  }

  // Update run status to 'running'
  await runStep(context, 'agent-eval-run:update-status', async () => {
    // Cases kept from before (a rerun replaces only the unverified ones) count
    // from the start, instead of showing 0 done until the next case ends.
    const kept = await new AgentEvalRunTopicModel(db, userId, wsId).findByRunId(runId);
    await runModel.update(runId, {
      metrics: {
        averageScore: 0,
        passRate: 0,
        ...runProgressOf(kept),
        totalCases: allTestCaseIds.length,
      },
      startedAt: new Date(),
      status: 'running',
    });
  });

  // Trigger paginate-test-cases workflow
  log('Triggering paginate-test-cases for run %s', runId);
  await runStep(context, 'agent-eval-run:trigger-paginate', () =>
    AgentEvalRunWorkflow.triggerPaginateTestCases({ runId, userId }),
  );

  return {
    ...result,
    message: `Triggered pagination for ${testCaseIds.length} test cases`,
  };
};

export const runBenchmarkWorkflowOptions = {
  flowControl: { key: 'agent-eval-run.process-run', parallelism: 100, rate: 1 },
};

import { serve } from '@upstash/workflow/nextjs';
import debug from 'debug';

import { AgentEvalRunModel, AgentEvalTestCaseModel } from '@/database/models/agentEval';
import { getServerDB } from '@/database/server';
import { qstashClient } from '@/libs/qstash';
import { AgentEvalRunWorkflow, type RunBenchmarkPayload } from '@/server/workflows/agentEvalRun';

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
export const { POST } = serve<RunBenchmarkPayload>(
  async (context) => {
    const { runId, dryRun, force, userId } = context.requestPayload ?? {};

    log('Starting: runId=%s dryRun=%s force=%s', runId, dryRun, force);

    if (!runId || !userId) {
      return { error: 'Missing runId or userId in payload', success: false };
    }

    const db = await getServerDB();
    const runModel = new AgentEvalRunModel(db, userId);

    // Get run info
    const run = await context.run('agent-eval-run:get-run', () => runModel.findById(runId));

    if (!run) {
      return { error: 'Run not found', success: false };
    }

    // Check run status
    if (run.status === 'running' && !force) {
      return { error: 'Run is already running', success: false };
    }

    // Get all test cases
    const testCaseModel = new AgentEvalTestCaseModel(db, userId);
    const allTestCases = await context.run('agent-eval-run:get-test-cases', () =>
      testCaseModel.findByDatasetId(run.datasetId),
    );

    const allTestCaseIds = allTestCases.map((tc: { id: string }) => tc.id);

    log('Total test cases: %d', allTestCaseIds.length);

    if (allTestCaseIds.length === 0) {
      return {
        error: 'No test cases in dataset',
        success: false,
        totalTestCases: 0,
      };
    }

    // Filter test cases that need execution
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

    // Trigger paginate-test-cases workflow
    log('Triggering paginate-test-cases for run %s', runId);
    await context.run('agent-eval-run:trigger-paginate', () =>
      AgentEvalRunWorkflow.triggerPaginateTestCases({ runId, userId }),
    );

    return {
      ...result,
      message: `Triggered pagination for ${testCaseIds.length} test cases`,
    };
  },
  {
    flowControl: { key: 'agent-eval-run.process-run', parallelism: 100, rate: 1 },
    qstashClient,
  },
);

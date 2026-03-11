import { serve } from '@upstash/workflow/nextjs';
import debug from 'debug';

import { getServerDB } from '@/database/server';
import { qstashClient } from '@/libs/qstash';
import { AgentEvalRunService } from '@/server/services/agentEvalRun';
import {
  AgentEvalRunWorkflow,
  type RunAgentTrajectoryPayload,
} from '@/server/workflows/agentEvalRun';

const log = debug('lobe-server:workflows:run-agent-trajectory');

/**
 * Run agent trajectory workflow - executes a single agent runtime call
 * For k=1: directly executes agent via completionWebhook
 * For k>1: creates K threads and triggers K run-thread-trajectory sub-workflows
 */
export const { POST } = serve<RunAgentTrajectoryPayload>(
  async (context) => {
    const { runId, testCaseId, userId } = context.requestPayload ?? {};

    log('Starting: runId=%s testCaseId=%s', runId, testCaseId);

    if (!runId || !testCaseId || !userId) {
      return { error: 'Missing required parameters', success: false };
    }

    const db = await getServerDB();
    const service = new AgentEvalRunService(db, userId);

    // Step 1: Read all required data
    const data = await context.run('agent-eval-run:load-data', () =>
      service.loadTrajectoryData(runId, testCaseId),
    );

    if ('error' in data) {
      return { error: data.error, success: false };
    }

    const { run, testCase, envPrompt } = data;

    if (run.status === 'aborted') {
      log('Run aborted, skipping: runId=%s testCaseId=%s', runId, testCaseId);
      return { cancelled: true };
    }

    const k = (run.config as { k?: number } | null)?.k ?? 1;

    // Step 2: Branch on k value
    if (k > 1) {
      // Multi-thread path: create K threads and trigger sub-workflows
      const result = await context.run('agent-eval-run:exec-multi-thread', () =>
        service.executeMultiThreadTrajectory({ k, run, runId, testCaseId }),
      );

      log(
        'Multi-thread started: runId=%s testCaseId=%s k=%d threads=%d',
        runId,
        testCaseId,
        k,
        result.threadIds.length,
      );

      return {
        k,
        success: true,
        testCaseId,
        threadIds: result.threadIds,
        topicId: result.topicId,
      };
    }

    // Single execution path (k=1): existing logic
    const result = await context.run('agent-eval-run:exec-agent', () =>
      service.executeTrajectory({ envPrompt, run, runId, testCase, testCaseId }),
    );

    // If execAgent failed, record completion and check if run should be finalized
    if ('error' in result) {
      await context.run('agent-eval-run:handle-exec-error', async () => {
        const { allDone } = await service.recordTrajectoryCompletion({
          runId,
          status: 'error',
          telemetry: { completionReason: 'error', errorMessage: result.error as string },
          testCaseId,
        });

        if (allDone) {
          log('All test cases done after exec error, triggering finalize: runId=%s', runId);
          await AgentEvalRunWorkflow.triggerFinalizeRun({ runId, userId });
        }
      });

      return { error: result.error, success: false, testCaseId };
    }

    log(
      'Agent started (async): runId=%s testCaseId=%s topicId=%s',
      runId,
      testCaseId,
      result.topicId,
    );

    return {
      success: true,
      testCaseId,
      topicId: result.topicId,
    };
  },
  {
    flowControl: {
      key: 'agent-eval-run.run-agent-trajectory',
      parallelism: 500,
      ratePerSecond: 10,
    },
    qstashClient,
  },
);

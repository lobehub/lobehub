import { serve } from '@upstash/workflow/nextjs';
import debug from 'debug';

import { getServerDB } from '@/database/server';
import { qstashClient } from '@/libs/qstash';
import { AgentEvalRunService } from '@/server/services/agentEvalRun';
import {
  AgentEvalRunWorkflow,
  type RunThreadTrajectoryPayload,
} from '@/server/workflows/agentEvalRun';

const log = debug('lobe-server:workflows:run-thread-trajectory');

/**
 * Run thread trajectory workflow - executes a single agent runtime call within a thread (for pass@k).
 * Each thread is an independent execution of the same test case.
 */
export const { POST } = serve<RunThreadTrajectoryPayload>(
  async (context) => {
    const { runId, testCaseId, threadId, topicId, userId } = context.requestPayload ?? {};

    log('Starting: runId=%s testCaseId=%s threadId=%s', runId, testCaseId, threadId);

    if (!runId || !testCaseId || !threadId || !topicId || !userId) {
      return { error: 'Missing required parameters', success: false };
    }

    const db = await getServerDB();
    const service = new AgentEvalRunService(db, userId);

    // Step 1: Load run + testCase data
    const data = await context.run('thread-trajectory:load-data', () =>
      service.loadTrajectoryData(runId, testCaseId),
    );

    if ('error' in data) {
      // Record thread as errored so aggregation can proceed
      await context.run('thread-trajectory:handle-load-error', async () => {
        await service.recordThreadCompletion({
          runId,
          status: 'error',
          telemetry: { completionReason: 'error', errorMessage: data.error },
          testCaseId,
          threadId,
          topicId,
        });
      });
      return { error: data.error, success: false };
    }

    const { run, testCase, envPrompt } = data;

    if (run.status === 'aborted') {
      log('Run aborted, skipping: runId=%s testCaseId=%s threadId=%s', runId, testCaseId, threadId);
      return { cancelled: true };
    }

    // Step 2: Execute agent for this thread
    const result = await context.run('thread-trajectory:exec-agent', () =>
      service.executeThreadTrajectory({
        envPrompt,
        run,
        runId,
        testCase,
        testCaseId,
        threadId,
        topicId,
      }),
    );

    if ('error' in result) {
      // execAgent failed to start — thread metadata already written by the service.
      // Check if all threads are done and handle finalization.
      await context.run('thread-trajectory:handle-exec-error', async () => {
        const { allRunDone } = await service.recordThreadCompletion({
          runId,
          status: 'error',
          telemetry: { completionReason: 'error', errorMessage: result.error },
          testCaseId,
          threadId,
          topicId,
        });

        if (allRunDone) {
          log('All test cases done after exec error, triggering finalize: runId=%s', runId);
          await AgentEvalRunWorkflow.triggerFinalizeRun({ runId, userId });
        }
      });

      return { error: result.error, success: false, testCaseId, threadId };
    }

    log('Thread agent started: runId=%s testCaseId=%s threadId=%s', runId, testCaseId, threadId);

    return { success: true, testCaseId, threadId, topicId };
  },
  {
    flowControl: {
      key: 'agent-eval-run.run-thread-trajectory',
      parallelism: 500,
      ratePerSecond: 10,
    },
    qstashClient,
  },
);

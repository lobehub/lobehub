import type { WorkflowContext } from '@upstash/workflow';
import debug from 'debug';

import { getServerDB } from '@/database/server';
import { AgentEvalRunService } from '@/server/services/agentEvalRun';
import {
  AgentEvalRunWorkflow,
  type RunAgentTrajectoryPayload,
} from '@/server/workflows/agentEvalRun';

const log = debug('lobe-server:workflows:run-agent-trajectory');

export const runAgentTrajectoryWorkflowConfig = {
  flowControl: {
    key: 'agent-eval-run.run-agent-trajectory',
    parallelism: 500,
    ratePerSecond: 20,
  },
};

export const runAgentTrajectoryWorkflowHandler = async (
  context: WorkflowContext<RunAgentTrajectoryPayload>,
) => {
  const { runId, testCaseId, userId } = context.requestPayload ?? {};

  log('Starting: runId=%s testCaseId=%s', runId, testCaseId);

  if (!runId || !testCaseId || !userId) {
    return { error: 'Missing required parameters', success: false };
  }

  const db = await getServerDB();
  const service = new AgentEvalRunService(db, userId);

  const data = await context.run('agent-eval-run:load-data', () =>
    service.loadTrajectoryData(runId, testCaseId),
  );

  if ('error' in data) {
    return { error: data.error, success: false };
  }

  const { envPrompt, run, testCase } = data;

  if (run.status === 'aborted') {
    log('Run aborted, skipping: runId=%s testCaseId=%s', runId, testCaseId);
    return { cancelled: true };
  }

  const k = (run.config as { k?: number } | null)?.k ?? 1;

  if (k > 1) {
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

  const result = await context.run('agent-eval-run:exec-agent', () =>
    service.executeTrajectory({ envPrompt, run, runId, testCase, testCaseId }),
  );

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
};

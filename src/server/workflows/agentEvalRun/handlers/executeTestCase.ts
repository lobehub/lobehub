import type { WorkflowContext } from '@upstash/workflow';
import debug from 'debug';

import { AgentEvalRunModel } from '@/database/models/agentEval';
import { getServerDB } from '@/database/server';
import { AgentEvalRunWorkflow, type ExecuteTestCasePayload } from '@/server/workflows/agentEvalRun';

const log = debug('lobe-server:workflows:execute-test-case');

export const executeTestCaseWorkflowConfig = {
  flowControl: {
    key: 'agent-eval-run.execute-test-case',
    parallelism: 200,
    ratePerSecond: 5,
  },
};

export const executeTestCaseWorkflowHandler = async (
  context: WorkflowContext<ExecuteTestCasePayload>,
) => {
  const { runId, testCaseId, userId } = context.requestPayload ?? {};

  log('Starting: runId=%s testCaseId=%s', runId, testCaseId);

  if (!runId || !testCaseId || !userId) {
    return { error: 'Missing runId, testCaseId, or userId', success: false };
  }

  const db = await getServerDB();

  const run = await context.run('agent-eval-run:get-run', async () => {
    const runModel = new AgentEvalRunModel(db, userId);
    return runModel.findById(runId);
  });

  if (!run) {
    return { error: 'Run not found', success: false };
  }

  if (run.status === 'aborted') {
    log('Run aborted, skipping: runId=%s testCaseId=%s', runId, testCaseId);
    return { cancelled: true };
  }

  const k = run.config?.k ?? 1;

  log('Executing: runId=%s testCaseId=%s k=%d', runId, testCaseId, k);

  await context.run(`agent-eval-run:trajectory:${runId}:${testCaseId}`, () =>
    AgentEvalRunWorkflow.triggerRunAgentTrajectory({ runId, testCaseId, userId }),
  );

  log('Completed: runId=%s testCaseId=%s k=%d', runId, testCaseId, k);

  return { k, success: true, testCaseId };
};

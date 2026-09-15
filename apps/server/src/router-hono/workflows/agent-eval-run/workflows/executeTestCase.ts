import { type WorkflowContext } from '@upstash/workflow';
import debug from 'debug';

import { AgentEvalRunModel } from '@/database/models/agentEval';
import { getServerDB } from '@/database/server';
import { AgentEvalRunWorkflow, type ExecuteTestCasePayload } from '@/server/workflows/agentEvalRun';
import { resolveAgentEvalRunWorkspace } from '@/server/workflows/agentEvalRun/utils';
import { runStep } from '@/server/workflows/step';

const log = debug('lobe-server:workflows:execute-test-case');

/**
 * Execute test case workflow - manages K executions of a single test case
 * 1. Get run config to determine K value
 * 2. Trigger K parallel run-agent-trajectory workflows
 * 3. Each trajectory executes the agent once and stores results
 */
export const executeTestCaseHandler = async (context: WorkflowContext<ExecuteTestCasePayload>) => {
  const { runId, testCaseId, userId } = context.requestPayload ?? {};

  log('Starting: runId=%s testCaseId=%s', runId, testCaseId);

  if (!runId || !testCaseId || !userId) {
    return { error: 'Missing runId, testCaseId, or userId', success: false };
  }

  const db = await getServerDB();
  const wsId = await resolveAgentEvalRunWorkspace(db, runId);

  // Get run to get K value from config
  const run = await runStep(context, 'agent-eval-run:get-run', async () => {
    const runModel = new AgentEvalRunModel(db, userId, wsId);
    return runModel.findById(runId);
  });

  if (!run) {
    return { error: 'Run not found', success: false };
  }

  if (run.status === 'aborted') {
    log('Run aborted, skipping: runId=%s testCaseId=%s', runId, testCaseId);
    return { cancelled: true };
  }

  // Get K value (default to 1 if not specified)
  const k = run.config?.k ?? 1;

  log('Executing: runId=%s testCaseId=%s k=%d', runId, testCaseId, k);

  // Trigger a single run-agent-trajectory workflow.
  // For k=1 it executes the agent directly; for k>1 it creates K threads internally.
  await runStep(context, `agent-eval-run:trajectory:${runId}:${testCaseId}`, () =>
    AgentEvalRunWorkflow.triggerRunAgentTrajectory({ runId, testCaseId, userId }),
  );

  log('Completed: runId=%s testCaseId=%s k=%d', runId, testCaseId, k);

  return { k, success: true, testCaseId };
};

export const executeTestCaseWorkflowOptions = {
  flowControl: {
    key: 'agent-eval-run.execute-test-case',
    parallelism: 200,
    ratePerSecond: 5,
  },
};

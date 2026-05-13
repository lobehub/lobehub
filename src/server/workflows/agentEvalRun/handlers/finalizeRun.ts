import type { WorkflowContext } from '@upstash/workflow';
import debug from 'debug';

import { AgentEvalRunModel, AgentEvalRunTopicModel } from '@/database/models/agentEval';
import { getServerDB } from '@/database/server';
import { AgentEvalRunService } from '@/server/services/agentEvalRun';
import type { FinalizeRunPayload } from '@/server/workflows/agentEvalRun';

const log = debug('lobe-server:workflows:finalize-run');

export const finalizeRunWorkflowConfig = {
  flowControl: { key: 'agent-eval-run.finalize-run', parallelism: 10, rate: 1 },
};

export const finalizeRunWorkflowHandler = async (context: WorkflowContext<FinalizeRunPayload>) => {
  const { runId, userId } = context.requestPayload ?? {};

  log('Starting: runId=%s', runId);

  if (!runId || !userId) {
    return { error: 'Missing runId or userId', success: false };
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
    log('Run aborted, skipping finalize: runId=%s', runId);
    return { cancelled: true };
  }

  const runTopics = await context.run('agent-eval-run:get-run-topics', async () => {
    const runTopicModel = new AgentEvalRunTopicModel(db, userId);
    return runTopicModel.findByRunId(runId);
  });

  log('Total RunTopics: %d', runTopics.length);

  const metrics = await context.run('agent-eval-run:aggregate-metrics', async () => {
    const service = new AgentEvalRunService(db, userId);
    return service.evaluateAndFinalizeRun({
      run: { config: run.config, id: runId, metrics: run.metrics, startedAt: run.startedAt },
      runTopics,
    });
  });

  log('Metrics: %O', metrics);

  const nonSuccessCases = (metrics.errorCases || 0) + (metrics.timeoutCases || 0);
  const externalCount = metrics.externalCases || 0;
  const runStatus =
    externalCount > 0 ? 'external' : nonSuccessCases >= metrics.totalCases ? 'failed' : 'completed';

  await context.run('agent-eval-run:update-run', async () => {
    const runModel = new AgentEvalRunModel(db, userId);
    return runModel.update(runId, { metrics, status: runStatus });
  });

  console.info(
    `[finalize-run] Run ${runId} ${runStatus}: score=${metrics.averageScore.toFixed(2)} pass=${metrics.passedCases}/${metrics.totalCases} error=${metrics.errorCases || 0}`,
  );

  return {
    metrics,
    runId,
    success: true,
  };
};

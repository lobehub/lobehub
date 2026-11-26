import { type WorkflowContext } from '@upstash/workflow';
import debug from 'debug';

import { AgentEvalRunModel, AgentEvalRunTopicModel } from '@/database/models/agentEval';
import { getServerDB } from '@/database/server';
import { AgentEvalRunService } from '@/server/services/agentEvalRun';
import { type FinalizeRunPayload } from '@/server/workflows/agentEvalRun';
import { resolveAgentEvalRunWorkspace } from '@/server/workflows/agentEvalRun/utils';
import { runStep } from '@/server/workflows/step';

const log = debug('lobe-server:workflows:finalize-run');

/**
 * Finalize run workflow - aggregates per-case evaluation results and updates run metrics
 *
 * Per-case evaluation is done in `recordTrajectoryCompletion` (on-trajectory-complete).
 * This workflow only aggregates the already-computed results.
 *
 * 1. Get run details
 * 2. Get all RunTopics for this run (with already-computed passed/score/evalResult)
 * 3. Aggregate metrics across all RunTopics
 * 4. Update run status to 'completed'
 */
type RunMetrics = Awaited<ReturnType<AgentEvalRunService['evaluateAndFinalizeRun']>>;

/** external: a topic awaits external scoring; failed: every case errored or timed out. */
const statusOf = (metrics: RunMetrics) => {
  const nonSuccessCases = (metrics.errorCases || 0) + (metrics.timeoutCases || 0);
  if ((metrics.externalCases || 0) > 0) return 'external' as const;
  return nonSuccessCases >= metrics.totalCases ? ('failed' as const) : ('completed' as const);
};

export const finalizeRunHandler = async (context: WorkflowContext<FinalizeRunPayload>) => {
  const { runId, userId } = context.requestPayload ?? {};

  log('Starting: runId=%s', runId);

  if (!runId || !userId) {
    return { error: 'Missing runId or userId', success: false };
  }

  const db = await getServerDB();
  const wsId = await resolveAgentEvalRunWorkspace(db, runId);

  // Step 1: Get run details
  const run = await runStep(context, 'agent-eval-run:get-run', async () => {
    const runModel = new AgentEvalRunModel(db, userId, wsId);
    const row = await runModel.findSummaryById(runId);
    return row
      ? {
          config: { k: row.config?.k },
          metrics: row.metrics,
          startedAt: row.startedAt,
          status: row.status,
        }
      : undefined;
  });

  if (!run) {
    return { error: 'Run not found', success: false };
  }

  if (run.status === 'aborted') {
    log('Run aborted, skipping finalize: runId=%s', runId);
    return { cancelled: true };
  }

  // Step 2: Get all RunTopics (already evaluated in recordTrajectoryCompletion)
  const runTopics = await runStep(context, 'agent-eval-run:get-run-topics', async () => {
    const runTopicModel = new AgentEvalRunTopicModel(db, userId, wsId);
    return (await runTopicModel.findByRunId(runId)).map(
      ({ evalResult, passed, runId, score, status, topicId }) => ({
        evalResult,
        passed,
        runId,
        score,
        status,
        topicId,
      }),
    );
  });

  log('Total RunTopics: %d', runTopics.length);

  // Step 3: Aggregate metrics from already-evaluated RunTopics
  const metrics = await runStep(context, 'agent-eval-run:aggregate-metrics', async () => {
    const service = new AgentEvalRunService(db, userId, wsId);
    return service.evaluateAndFinalizeRun({
      run: { config: run.config, id: runId, metrics: run.metrics, startedAt: run.startedAt },
      runTopics,
    });
  });

  log('Metrics: %O', metrics);

  // Step 4: Update run status
  // external: any topic awaits external scoring → whole run waits too
  // failed: all cases are non-success (error/timeout)
  // completed: everything else
  const runStatus = statusOf(metrics);

  const finalized = await runStep(context, 'agent-eval-run:update-run', async () => {
    // Steps 2-3 are checkpoints that may predate the last verdicts: finalization
    // only succeeds once no case is pending or running, so it must write metrics
    // aggregated from the topics as they are now, in this same step.
    const runTopicModel = new AgentEvalRunTopicModel(db, userId, wsId);
    const currentTopics = (await runTopicModel.findByRunId(runId)).map(
      ({ evalResult, passed, runId, score, status, topicId }) => ({
        evalResult,
        passed,
        runId,
        score,
        status,
        topicId,
      }),
    );
    const current = await new AgentEvalRunService(db, userId, wsId).evaluateAndFinalizeRun({
      run: { config: run.config, id: runId, metrics: run.metrics, startedAt: run.startedAt },
      runTopics: currentTopics,
    });
    const runModel = new AgentEvalRunModel(db, userId, wsId);
    return !!(await runModel.finalize(
      runId,
      { metrics: current, status: statusOf(current) },
      { startedAt: run.startedAt },
    ));
  });

  if (!finalized) return { cancelled: true };

  console.info(
    `[finalize-run] Run ${runId} ${runStatus}: score=${metrics.averageScore.toFixed(2)} pass=${metrics.passedCases}/${metrics.totalCases} error=${metrics.errorCases || 0}`,
  );

  return {
    metrics,
    runId,
    success: true,
  };
};

export const finalizeRunWorkflowOptions = {
  flowControl: { key: 'agent-eval-run.finalize-run', parallelism: 10, rate: 1 },
};

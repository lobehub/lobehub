import { serve } from '@upstash/workflow/nextjs';
import debug from 'debug';

import { AgentEvalRunModel, AgentEvalRunTopicModel } from '@/database/models/agentEval';
import { getServerDB } from '@/database/server';
import { qstashClient } from '@/libs/qstash';
import { AgentEvalRunService } from '@/server/services/agentEvalRun';
import { type FinalizeRunPayload } from '@/server/workflows/agentEvalRun';

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
export const { POST } = serve<FinalizeRunPayload>(
  async (context) => {
    const { runId, userId } = context.requestPayload ?? {};

    log('Starting: runId=%s', runId);

    if (!runId || !userId) {
      return { error: 'Missing runId or userId', success: false };
    }

    const db = await getServerDB();

    // Step 1: Get run details
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

    // Step 2: Get all RunTopics (already evaluated in recordTrajectoryCompletion)
    const runTopics = await context.run('agent-eval-run:get-run-topics', async () => {
      const runTopicModel = new AgentEvalRunTopicModel(db, userId);
      return runTopicModel.findByRunId(runId);
    });

    log('Total RunTopics: %d', runTopics.length);

    // Step 3: Aggregate metrics from already-evaluated RunTopics
    const metrics = await context.run('agent-eval-run:aggregate-metrics', async () => {
      const service = new AgentEvalRunService(db, userId);
      return service.evaluateAndFinalizeRun({
        run: { config: run.config, id: runId, metrics: run.metrics, startedAt: run.startedAt },
        runTopics,
      });
    });

    log('Metrics: %O', metrics);

    // Step 4: Update run status (failed if all cases errored/timed out)
    const nonSuccessCases = (metrics.errorCases || 0) + (metrics.timeoutCases || 0);
    const runStatus = nonSuccessCases >= metrics.totalCases ? 'failed' : 'completed';

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
  },
  {
    flowControl: { key: 'agent-eval-run.finalize-run', parallelism: 10, rate: 1 },
    qstashClient,
  },
);

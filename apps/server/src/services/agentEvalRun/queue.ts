import type { EvalRunConfig } from '@lobechat/types';
import pMap from 'p-map';

import { AgentEvalRunWorkflow } from '@/server/workflows/agentEvalRun';

import { QUEUED_TRIGGER_CONCURRENCY } from './constants';
import type { EvalRunDeps } from './types';

/**
 * The number of cases an internal run executes at once, when it sets one. An
 * external run's worker paces itself, so the limit only queues internal runs.
 */
export const queuedConcurrencyOf = (config?: EvalRunConfig | null): number | undefined => {
  if (config?.executionMode === 'external') return undefined;
  const limit = Math.floor(config?.maxConcurrency ?? 0);
  return limit >= 1 ? limit : undefined;
};

/**
 * Start the waiting cases of a run with a concurrency limit, as many as it has
 * free slots. Called when the run starts and whenever one of its cases ends.
 *
 * @returns the cases started, or `undefined` when the run has no limit (every
 * case is started by the paginated fan-out instead)
 */
export async function dispatchQueuedCases(
  deps: EvalRunDeps,
  runId: string,
  config?: EvalRunConfig | null,
): Promise<string[] | undefined> {
  const runConfig =
    config === undefined ? (await deps.runModel.findSummaryById(runId))?.config : config;
  const limit = queuedConcurrencyOf(runConfig);
  if (!limit) return undefined;

  const claimed = await deps.executionRepo.claimQueuedCases(runId, limit);
  const failed: string[] = [];
  await pMap(
    claimed,
    async (testCaseId) => {
      try {
        await AgentEvalRunWorkflow.triggerExecuteTestCase({
          runId,
          testCaseId,
          userId: deps.userId,
        });
      } catch (error) {
        console.error('[agentEvalRun] failed to start queued case', runId, testCaseId, error);
        failed.push(testCaseId);
      }
    },
    { concurrency: QUEUED_TRIGGER_CONCURRENCY },
  );
  // A slot whose start never left must not stay taken until it goes stale.
  await deps.executionRepo.releaseQueuedCases(runId, failed);
  // With nothing started, no case will end to refill the queue: fail so the
  // caller's durable step retries the dispatch instead of leaving the run idle.
  if (claimed.length > 0 && failed.length === claimed.length) {
    throw new Error(`Could not start any queued case of run ${runId}`);
  }
  return claimed.filter((id) => !failed.includes(id));
}

/** Refill free slots after a case ends; a failure here must not undo recording the case. */
export async function refillQueuedCases(
  deps: EvalRunDeps,
  runId: string,
  config?: EvalRunConfig | null,
) {
  if (config !== undefined && !queuedConcurrencyOf(config)) return;
  try {
    await dispatchQueuedCases(deps, runId, config);
  } catch (error) {
    console.error('[agentEvalRun] failed to refill queued cases', runId, error);
  }
}

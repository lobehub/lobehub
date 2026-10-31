import pMap from 'p-map';

import { evaluateAndFinalizeRun } from './aggregate';
import { assertRunCaseCompatibility } from './caseCompatibility';
import { evaluateCase } from './completion';
import { REJUDGEABLE_STATUSES } from './judgeError';
import { rejudgeTopicThreads } from './thread';
import type { EvalRunDeps } from './types';

const REJUDGE_CONCURRENCY = 4;

export interface RejudgeRunResult {
  failedCases: number;
  /** Cases still without a verdict after this re-judge: the judge failed again. */
  judgeErrorCases: number;
  passedCases: number;
  /** Cases graded again. */
  rejudged: number;
}

/**
 * Grades a finished run again with the dataset's current judge setup (eval
 * mode, rules, judge model, evidence) from the trajectories it recorded: no
 * model answers again, only the judge runs. Cases with a verdict and cases
 * whose judge failed (`judge_error`) are graded again; cases that never ran to
 * an answer (errors, timeouts, external) are left as they are, and the run's
 * metrics are rebuilt from the new verdicts.
 */
export async function rejudgeRun(deps: EvalRunDeps, runId: string): Promise<RejudgeRunResult> {
  const run = await deps.runModel.findById(runId);
  if (!run) throw new Error('Run not found');
  if (run.status === 'running' || run.status === 'pending') {
    throw new Error(`Cannot re-judge a ${run.status} run`);
  }

  const runTopics = await deps.runTopicModel.findByRunId(runId);
  const targets = runTopics.filter((runTopic) => REJUDGEABLE_STATUSES.has(runTopic.status ?? ''));
  await assertRunCaseCompatibility(deps, run, targets);

  await pMap(
    targets,
    async (runTopic) => {
      if (runTopic.evalResult?.threads?.length) {
        await rejudgeTopicThreads(deps, {
          runId,
          testCaseId: runTopic.testCaseId,
          topicId: runTopic.topicId,
        });
      } else {
        await evaluateCase(deps, runId, runTopic);
      }
    },
    { concurrency: REJUDGE_CONCURRENCY },
  );

  const fresh = await deps.runTopicModel.findByRunId(runId);
  const metrics = await evaluateAndFinalizeRun({ run, runTopics: fresh });
  await deps.runModel.update(runId, {
    // The wall-clock duration belongs to the original execution.
    metrics: { ...metrics, duration: run.metrics?.duration ?? metrics.duration },
  });

  return {
    failedCases: metrics.failedCases,
    judgeErrorCases: metrics.judgeErrorCases ?? 0,
    passedCases: metrics.passedCases,
    rejudged: targets.length,
  };
}

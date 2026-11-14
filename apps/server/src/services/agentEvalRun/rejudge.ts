import pMap from 'p-map';

import { evaluateAndFinalizeRun } from './aggregate';
import { assertRunCaseCompatibility } from './caseCompatibility';
import { evaluateCase } from './completion';
import { isRegradableEmptyAnswer } from './emptyAnswer';
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
 * whose judge failed (`judge_error`) are graded again, and so are attempts
 * once held as errors for an empty answer; other cases that never ran to an
 * answer (errors, timeouts, external) are left as they are, and the run's
 * metrics are rebuilt from the new verdicts.
 */
export async function rejudgeRun(deps: EvalRunDeps, runId: string): Promise<RejudgeRunResult> {
  const run = await deps.runModel.findById(runId);
  if (!run) throw new Error('Run not found');
  if (run.status === 'running' || run.status === 'pending') {
    throw new Error(`Cannot re-judge a ${run.status} run`);
  }

  const runTopics = await deps.runTopicModel.findByRunId(runId);
  // Also cases held as errors only for attempts that ended with no answer,
  // which the current reading may grade as failures.
  const targets = runTopics.filter(
    (runTopic) =>
      REJUDGEABLE_STATUSES.has(runTopic.status ?? '') ||
      (runTopic.status === 'error' &&
        (runTopic.evalResult?.threads?.some(isRegradableEmptyAnswer) ||
          isRegradableEmptyAnswer({ error: runTopic.evalResult?.error, status: runTopic.status }))),
  );
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

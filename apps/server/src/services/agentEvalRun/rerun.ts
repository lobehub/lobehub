import { assertRunCaseCompatibility } from './caseCompatibility';
import { createRunTopics } from './createRun';
import type { EvalRunDeps } from './types';

/**
 * Attempt statuses that are not a verdict: the model never answered (error,
 * timeout) or the judge could not grade the answer (judge_error).
 */
export const UNVERIFIED_STATUSES: ReadonlySet<string> = new Set([
  'error',
  'judge_error',
  'timeout',
]);

interface RerunCandidate {
  evalResult?: {
    error?: string | null;
    threads?: Array<{ status?: string | null; error?: string | null }> | null;
  } | null;
  status?: string | null;
}

/**
 * A case runs again when the case itself, or any of its k attempts, has no
 * verdict. The whole case runs again (every attempt), so its pass^k reading
 * rests on one fresh sample instead of a patchwork of old and new attempts.
 */
export const needsRerun = (topic: RerunCandidate) =>
  UNVERIFIED_STATUSES.has(topic.status ?? '') ||
  topic.evalResult?.error === 'No assistant output' ||
  (topic.evalResult?.threads ?? []).some(
    (thread) =>
      UNVERIFIED_STATUSES.has(thread.status ?? '') || thread.error === 'No assistant output',
  );

/**
 * Runs again every case of a finished run that has an attempt without a
 * verdict, with the run's own settings. Lobe Bench's one answer to errors,
 * timeouts and judge failures alike: the model answers
 * again and the judge grades as part of the normal execution; nothing is
 * re-graded in place. Old Topics stay for audit, as with `retryErrorCases`;
 * only the RunTopic rows are replaced and the run goes back to `pending` for
 * the workflow to pick up.
 */
export async function rerunUnverifiedCases(
  deps: EvalRunDeps,
  runId: string,
): Promise<{ rerunCount: number }> {
  const run = await deps.runModel.findById(runId);
  if (!run) throw new Error('Run not found');
  if (run.status === 'running' || run.status === 'pending') {
    throw new Error(`Cannot rerun a ${run.status} run`);
  }

  const runTopics = await deps.runTopicModel.findByRunId(runId);
  const targets = runTopics.filter((runTopic) => needsRerun(runTopic));
  await assertRunCaseCompatibility(deps, run, targets);
  if (targets.length === 0) return { rerunCount: 0 };

  for (const target of targets) {
    await deps.runTopicModel.deleteByRunAndTestCase(runId, target.testCaseId);
  }
  await createRunTopics(
    deps,
    run,
    targets.map((target) => ({
      content: target.testCase?.content ?? { input: '' },
      environmentId: target.testCase?.environmentId ?? null,
      id: target.testCaseId,
      sortOrder: target.testCase?.sortOrder ?? null,
    })),
  );
  await deps.runModel.update(runId, { status: 'pending' });

  return { rerunCount: targets.length };
}

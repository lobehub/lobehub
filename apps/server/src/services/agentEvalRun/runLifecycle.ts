import type { EvalRunConfig, EvalRunMetrics, EvalRunTopicResult } from '@lobechat/types';

import { AgentOperationModel } from '@/database/models/agentOperation';
import { AgentRuntimeService } from '@/server/services/agentRuntime/AgentRuntimeService';

import { evaluateAndFinalizeRun } from './aggregate';
import { deleteCaseAgents } from './caseAgent';
import { assertRunCaseCompatibility } from './caseCompatibility';
import { createRunTopics } from './createRun';
import type { EvalRunDeps } from './types';

export async function deleteRun(deps: EvalRunDeps, id: string) {
  // 1. Get associated topics before deletion (cascade will remove run_topics rows)
  const runTopics = await deps.runTopicModel.findByRunId(id);
  const topicIds = runTopics.map((rt) => rt.topicId).filter(Boolean);

  // 2. Delete the run (cascades to run_topics)
  const result = await deps.runModel.delete(id);

  // 3. Delete orphaned topics
  if (topicIds.length > 0) {
    await deps.topicModel.batchDelete(topicIds);
  }

  // 4. Delete the hidden case Agents the run created (with any topics kept
  //    from retries, which cascade with their Agent)
  await deleteCaseAgents(deps, id);

  return result;
}

/** Interrupt every still-open operation under an attempt, preserving finished children. */
export async function interruptEvalOperations(deps: EvalRunDeps, operationIds: string[]) {
  const runtime = new AgentRuntimeService(deps.db, deps.userId);
  const operations = new AgentOperationModel(deps.db, deps.userId, deps.workspaceId);
  const open = new Set([
    'pending',
    'running',
    'waiting_for_async_tool',
    'waiting_for_client',
    'waiting_for_human',
  ]);
  const interrupted = new Set<string>();
  for (const operationId of new Set(operationIds)) {
    const tree = await operations.listOperationTree(operationId).catch(() => []);
    const ids = [operationId, ...tree.filter((op) => open.has(op.status ?? '')).map((op) => op.id)];
    for (const id of ids) {
      if (interrupted.has(id)) continue;
      interrupted.add(id);
      await runtime.interruptOperation(id).catch(() => undefined);
    }
  }
}

export async function abortRun(deps: EvalRunDeps, runId: string) {
  // Close the write gate before interrupting: interruption itself can deliver
  // completion callbacks. Keep partial results and operation ids for audit.
  const stoppedTopics = await deps.runTopicModel.batchMarkAborted(runId);

  const operationIds: string[] = [];
  for (const rt of stoppedTopics) {
    const result = rt.evalResult as EvalRunTopicResult | null;
    if (result?.operationId) operationIds.push(result.operationId);
    for (const attempt of result?.threads ?? []) {
      if (attempt.operationId) operationIds.push(attempt.operationId);
    }
  }
  await interruptEvalOperations(deps, operationIds);
}

export async function retryErrorCases(
  deps: EvalRunDeps,
  runId: string,
): Promise<{ retryCount: number }> {
  const run = await deps.runModel.findById(runId);
  if (!run) throw new Error('Run not found');

  const allTopics = await deps.runTopicModel.findByRunId(runId);
  const errorTopics = allTopics.filter((t) => t.status === 'error' || t.status === 'timeout');
  await assertRunCaseCompatibility(deps, run, errorTopics);

  if (errorTopics.length === 0) return { retryCount: 0 };

  // Collect test case IDs and info for recreation
  const errorTestCases = errorTopics.map((t) => ({
    content: t.testCase?.content ?? { input: '' },
    environmentId: t.testCase?.environmentId ?? null,
    id: t.testCaseId,
    sortOrder: t.testCase?.sortOrder ?? null,
  }));

  // 1. Delete error/terminal RunTopics (the filter above excludes active
  // running/pending cases, so only terminal rows are ever removed).
  await deps.runTopicModel.deleteErrorRunTopics(runId);

  // 2. Preserve old Topics (old conversations are kept for audit/history);
  // only the RunTopic association is replaced.
  // 3. Create fresh Topics, histories, and pending RunTopics together.
  await createRunTopics(deps, run, errorTestCases);

  // 4. Set run status to pending
  await deps.runModel.update(runId, {
    startedAt: new Date(Math.max(Date.now(), (run.startedAt?.getTime() ?? 0) + 1)),
    status: 'pending',
  });

  return { retryCount: errorTopics.length };
}

export async function retrySingleCase(deps: EvalRunDeps, runId: string, testCaseId: string) {
  const run = await deps.runModel.findById(runId);
  if (!run) throw new Error('Run not found');

  const runTopic = await deps.runTopicModel.findByRunAndTestCase(runId, testCaseId);
  if (!runTopic) throw new Error('RunTopic not found');

  // Active associations must not be replaced — surface a conflict.
  if (runTopic.status === 'running' || runTopic.status === 'pending') {
    throw new Error(`Cannot retry: case is ${runTopic.status}`);
  }
  // The attempt ran; only its grading failed. Re-judge it instead of paying
  // for the candidate again.
  if (runTopic.status === 'judge_error') {
    throw new Error('Cannot retry: the attempt ran but was not judged; re-judge it instead');
  }
  await assertRunCaseCompatibility(deps, run, [runTopic]);

  // 1. Delete old RunTopic association
  await deps.runTopicModel.deleteByRunAndTestCase(runId, testCaseId);

  // 2. Preserve the old Topic (conversation history); only re-link.
  // 3. Create a fresh Topic, its history, and its RunTopic together.
  await createRunTopics(deps, run, [
    {
      content: runTopic.testCase?.content ?? { input: '' },
      environmentId: runTopic.testCase?.environmentId ?? null,
      id: testCaseId,
      sortOrder: runTopic.testCase?.sortOrder ?? null,
    },
  ]);

  // 5. Set run status to running
  await deps.runModel.update(runId, {
    startedAt: new Date(Math.max(Date.now(), (run.startedAt?.getTime() ?? 0) + 1)),
    status: 'running',
  });
}

export async function getRunDetails(deps: EvalRunDeps, id: string) {
  let run = await deps.runModel.findById(id);
  if (!run) return null;

  // Check if a 'running' run has timed out
  if (run.status === 'running') {
    const timedOut = await checkAndHandleRunTimeout(deps, run);
    if (timedOut) {
      run = (await deps.runModel.findById(id))!;
    }
  }

  // Get dataset and run topics in parallel
  const [dataset, runTopics] = await Promise.all([
    deps.datasetModel.findById(run.datasetId),
    deps.runTopicModel.findByRunId(id),
  ]);

  // Get target agent display info via AgentService (fallback for runs without snapshot)
  let targetAgent:
    { avatar?: string; id: string; model?: string; provider?: string; title?: string } | undefined;
  if (run.targetAgentId) {
    const agentConfig = await deps.agentService.getAgentConfigById(run.targetAgentId);
    if (agentConfig) {
      targetAgent = {
        avatar: agentConfig.avatar,
        id: run.targetAgentId,
        model: agentConfig.model,
        provider: agentConfig.provider,
        title: agentConfig.title,
      };
    }
  }

  return {
    ...run,
    dataset,
    targetAgent,
    topics: runTopics.map((rt) => ({
      createdAt: rt.createdAt,
      evalResult: rt.evalResult,
      passed: rt.passed,
      score: rt.score,
      status: rt.status,
      testCase: rt.testCase,
      testCaseId: rt.testCaseId,
      topic: rt.topic,
    })),
  };
}

export async function getAgentDisplayInfo(deps: EvalRunDeps, agentId: string) {
  const agentConfig = await deps.agentService.getAgentConfigById(agentId);
  if (!agentConfig) return undefined;
  return {
    avatar: agentConfig.avatar,
    id: agentId,
    model: agentConfig.model,
    provider: agentConfig.provider,
    title: agentConfig.title,
  };
}

/**
 * Check each pending RunTopic individually against the per-case timeout.
 * If a topic's createdAt + timeout has elapsed, mark it as 'timeout' and write duration.
 * If all topics reach terminal state after this, finalize the run (aggregate metrics + mark completed).
 * Returns true if any state was changed.
 */
export async function checkAndHandleRunTimeout(
  deps: EvalRunDeps,
  run: {
    config?: EvalRunConfig | null;
    id: string;
    metrics?: EvalRunMetrics | null;
    startedAt?: Date | null;
  },
): Promise<boolean> {
  const perCaseTimeout = (run.config?.timeout as number) ?? 1_200_000; // 20 min default
  const now = Date.now();

  // Early exit: if run started less than timeout ago, no topic could have timed out
  if (run.startedAt && now - new Date(run.startedAt).getTime() < perCaseTimeout) {
    return false;
  }

  // Single SQL: mark pending topics where created_at + timeout < NOW() as 'timeout'
  const timedOutRows = await deps.runTopicModel.batchMarkTimeout(run.id, perCaseTimeout);
  if (timedOutRows.length === 0) return false;

  const operations = timedOutRows
    .flatMap((row) => [
      row.evalResult?.operationId,
      ...(row.evalResult?.threads ?? []).map((thread) => thread.operationId),
    ])
    .filter((id): id is string => !!id);
  await interruptEvalOperations(deps, operations);

  // Write evalResult with duration for each timed-out topic
  for (const row of timedOutRows) {
    const duration = row.createdAt ? now - new Date(row.createdAt).getTime() : undefined;
    await deps.runTopicModel.updateByRunAndTopic(
      row.runId,
      row.topicId,
      {
        evalResult: {
          ...(row.evalResult as EvalRunTopicResult),
          completionReason: 'timeout',
          duration,
          rubricScores: (row.evalResult as EvalRunTopicResult)?.rubricScores ?? [],
        },
        passed: false,
        score: 0,
      },
      { executionId: row.evalResult?.executionId, status: 'timeout' },
    );
  }

  // Re-aggregate metrics from all RunTopics (including newly timed-out ones)
  const allTopics = await deps.runTopicModel.findByRunId(run.id);
  const pendingCount = allTopics.filter(
    (t) => !t.status || t.status === 'pending' || t.status === 'running',
  ).length;

  if (pendingCount === 0) {
    // All topics in terminal state → finalize with full metrics
    const metrics = await evaluateAndFinalizeRun({
      run: { id: run.id, metrics: run.metrics, startedAt: run.startedAt },
      runTopics: allTopics,
    });

    const nonSuccessCases = (metrics.errorCases || 0) + (metrics.timeoutCases || 0);
    const externalCount = metrics.externalCases || 0;
    const runStatus =
      externalCount > 0
        ? 'external'
        : nonSuccessCases >= metrics.totalCases
          ? 'failed'
          : 'completed';

    await deps.runModel.finalize(
      run.id,
      { metrics, status: runStatus },
      { startedAt: run.startedAt },
    );
  } else {
    // Some topics still running → update real-time metrics so progress reflects timeouts
    const completedCount = allTopics.filter(
      (t) => (t.evalResult && 'completionReason' in t.evalResult) || t.status === 'timeout',
    ).length;
    const passedCases = allTopics.filter((t) => t.status === 'passed').length;
    const failedCases = allTopics.filter((t) => t.status === 'failed').length;
    const errorCases = allTopics.filter((t) => t.status === 'error').length;
    const timeoutCases = allTopics.filter((t) => t.status === 'timeout').length;
    const judgeErrorCases = allTopics.filter((t) => t.status === 'judge_error').length;

    await deps.runModel.update(
      run.id,
      {
        metrics: {
          ...(run.metrics as EvalRunMetrics),
          completedCases: completedCount,
          errorCases,
          failedCases,
          judgeErrorCases: judgeErrorCases || undefined,
          passedCases,
          timeoutCases,
        },
      },
      { startedAt: run.startedAt },
    );
  }

  return true;
}

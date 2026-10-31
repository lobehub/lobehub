import { LOADING_FLAT } from '@lobechat/const';
import type { EvalRunTopicResult, EvalThreadResult } from '@lobechat/types';
import pMap from 'p-map';

import type { ThreadModel } from '@/database/models/thread';
import { AgentEvalRunWorkflow } from '@/server/workflows/agentEvalRun';

import { resolveTopicAgentId } from './caseAgent';
import { assertRunCaseCompatibility, EvalCaseCompatibilityError } from './caseCompatibility';
import { loadTrajectoryData } from './trajectory';
import type { EvalRunDeps } from './types';
import { getCaseId, log } from './utils';

export class EvalResumeConflictError extends Error {}

const RESUMABLE_THREAD_STATUSES = new Set(['error', 'timeout']);
/** Caps concurrent per-case resume checks (each issues several DB reads). */
const RESUME_CHECK_CONCURRENCY = 5;

interface ResumableCaseTarget {
  caseStatus?: string | null;
  input: string;
  resumeStatus?: 'error' | 'timeout';
  sortOrder: number | null;
  testCaseId: string;
  threadId?: string;
}

interface ResumableThreadResult extends EvalThreadResult {
  status: 'error' | 'timeout';
}

export async function canResumeTrajectory(
  deps: EvalRunDeps,
  params: { runId: string; testCaseId: string; threadId?: string },
) {
  const invalidResumeTargetReason = 'Invalid resume target';
  const trajectoryNotResumableReason = 'Trajectory is not resumable';
  const resumeLimitReachedReason = 'Resume limit reached';

  log('canResumeTrajectory: %O', params);
  const run = await deps.runModel.findById(params.runId);
  if (!run) return { canResume: false, reason: invalidResumeTargetReason };

  if (!['aborted', 'failed', 'running'].includes(run.status)) {
    return { canResume: false, reason: trajectoryNotResumableReason };
  }

  const runTopic = await deps.runTopicModel.findByRunAndTestCase(params.runId, params.testCaseId);
  if (!runTopic) return { canResume: false, reason: invalidResumeTargetReason };
  try {
    await assertRunCaseCompatibility(deps, run, [runTopic]);
  } catch (error) {
    if (error instanceof EvalCaseCompatibilityError)
      return { canResume: false, reason: error.message };
    throw error;
  }

  log('canResumeTrajectory: runTopic.status=%s topicId=%s', runTopic.status, runTopic.topicId);

  const k = run.config?.k ?? 1;
  const hasInvalidThreadTarget = (k === 1 && !!params.threadId) || (k > 1 && !params.threadId);
  if (hasInvalidThreadTarget) {
    return { canResume: false, reason: invalidResumeTargetReason };
  }

  if (!runTopic.topicId) {
    return { canResume: false, reason: invalidResumeTargetReason };
  }

  if (k === 1 && !RESUMABLE_THREAD_STATUSES.has(runTopic.status ?? '')) {
    log('canResumeTrajectory: rejected — runTopic.status=%s', runTopic.status);
    return { canResume: false, reason: trajectoryNotResumableReason };
  }

  if (params.threadId) {
    const thread = await deps.threadModel.findById(params.threadId);

    if (!thread || thread.topicId !== runTopic.topicId || thread.type !== 'eval') {
      return { canResume: false, reason: invalidResumeTargetReason };
    }

    const targetThread = runTopic.evalResult?.threads?.find(
      (item) => item.threadId === params.threadId,
    );

    if (!targetThread || !RESUMABLE_THREAD_STATUSES.has(targetThread.status ?? '')) {
      return { canResume: false, reason: trajectoryNotResumableReason };
    }

    const maxSteps = run.config?.maxSteps;
    const prevSteps =
      ((thread.metadata as Record<string, unknown> | null)?.steps as number | undefined) ?? 0;

    if (maxSteps && prevSteps >= maxSteps) {
      log(
        'canResumeTrajectory: rejected thread — prevSteps=%d >= maxSteps=%d',
        prevSteps,
        maxSteps,
      );
      return { canResume: false, reason: resumeLimitReachedReason };
    }
  }

  // pass@1 resumes track steps on the runTopic; pass@k uses per-thread metadata above.
  if (k > 1) return { canResume: true as const };

  // Reject if the previous run already exhausted maxSteps
  const maxSteps = run.config?.maxSteps;
  const prevSteps = runTopic.evalResult?.steps ?? 0;
  if (maxSteps && prevSteps >= maxSteps) {
    log('canResumeTrajectory: rejected — prevSteps=%d >= maxSteps=%d', prevSteps, maxSteps);
    return { canResume: false, reason: resumeLimitReachedReason };
  }

  return { canResume: true as const };
}

/**
 * Batch-check which error/timeout cases in a run can be resumed.
 * Returns one entry per candidate case with canResume + optional reason.
 */
export async function getResumableCases(deps: EvalRunDeps, runId: string) {
  const run = await deps.runModel.findById(runId);
  if (!run) return [];

  const allTopics = await deps.runTopicModel.findByRunId(runId);
  const k = run.config?.k ?? 1;
  const candidates = allTopics
    .map((topic) => getResumableCaseTarget(topic, k))
    .filter((topic): topic is ResumableCaseTarget => !!topic);

  const results = await pMap(
    candidates,
    async (candidate) => {
      const check = await canResumeTrajectory(deps, {
        runId,
        testCaseId: candidate.testCaseId,
        threadId: candidate.threadId,
      });
      return {
        caseStatus: candidate.caseStatus,
        canResume: check.canResume,
        input: candidate.input,
        reason: 'reason' in check ? check.reason : undefined,
        resumeStatus: candidate.resumeStatus,
        sortOrder: candidate.sortOrder,
        testCaseId: candidate.testCaseId,
        threadId: candidate.threadId,
      };
    },
    { concurrency: RESUME_CHECK_CONCURRENCY },
  );

  return results;
}

export async function resumeTrajectory(
  deps: EvalRunDeps,
  params: { runId: string; testCaseId: string; threadId?: string },
) {
  log('resumeTrajectory: %O', params);
  const resumeCheck = await canResumeTrajectory(deps, params);
  if (!resumeCheck.canResume) {
    log('resumeTrajectory: canResume=false reason=%s', resumeCheck.reason);
    throw new EvalResumeConflictError(resumeCheck.reason);
  }

  const target = await resolveTrajectoryResumeTarget(deps, params);
  const { caseId, envPrompt, environment, parentMessageId, run, runTopic, thread, topicId } =
    target;
  log(
    'resumeTrajectory: resolved target — topicId=%s parentMessageId=%s threadId=%s',
    topicId,
    parentMessageId,
    thread?.id,
  );

  // Resume on the Agent the topic belongs to (a hidden case Agent or the target Agent).
  const targetAgentId = await resolveTopicAgentId(deps, topicId, run.targetAgentId);

  if (thread) {
    log('resumeTrajectory: triggering resume-thread-trajectory');
    await AgentEvalRunWorkflow.triggerResumeThreadTrajectory({
      expectedExecutionId: runTopic.evalResult?.executionId,
      appContext: { threadId: thread.id, topicId },
      caseId,
      envPrompt,
      maxSteps: run.config?.maxSteps,
      parentMessageId,
      runId: run.id,
      targetAgentId,
      testCaseId: params.testCaseId,
      threadId: thread.id,
      topicId,
      environment,
      userId: deps.userId,
    });
  } else {
    log('resumeTrajectory: triggering resume-agent-trajectory');
    await AgentEvalRunWorkflow.triggerResumeAgentTrajectory({
      expectedExecutionId: runTopic.evalResult?.executionId,
      appContext: { topicId },
      caseId,
      envPrompt,
      maxSteps: run.config?.maxSteps,
      parentMessageId,
      runId: run.id,
      targetAgentId,
      testCaseId: params.testCaseId,
      topicId,
      environment,
      userId: deps.userId,
    });
  }

  const result = {
    mode: thread ? ('thread' as const) : ('single' as const),
    runId: run.id,
    testCaseId: params.testCaseId,
    threadId: thread?.id,
    topicId,
    triggered: true,
  };
  log('resumeTrajectory: done %O', result);
  return result;
}

function getResumableCaseTarget(
  runTopic: {
    evalResult?: EvalRunTopicResult | null;
    status?: string | null;
    testCase?: { content?: { input?: string } | null; sortOrder?: number | null } | null;
    testCaseId: string;
  },
  k: number,
): ResumableCaseTarget | undefined {
  if (k === 1) {
    if (!RESUMABLE_THREAD_STATUSES.has(runTopic.status ?? '')) return undefined;

    return {
      caseStatus: runTopic.status,
      input: runTopic.testCase?.content?.input ?? '',
      resumeStatus: runTopic.status as 'error' | 'timeout',
      sortOrder: runTopic.testCase?.sortOrder ?? null,
      testCaseId: runTopic.testCaseId,
    };
  }

  const resumableThread = getResumableThread(runTopic.evalResult?.threads);
  if (!resumableThread?.status) return undefined;

  return {
    caseStatus: runTopic.status,
    input: runTopic.testCase?.content?.input ?? '',
    resumeStatus: resumableThread.status,
    sortOrder: runTopic.testCase?.sortOrder ?? null,
    testCaseId: runTopic.testCaseId,
    threadId: resumableThread.threadId,
  };
}

function getResumableThread(threads?: EvalThreadResult[]) {
  return threads?.find((thread): thread is ResumableThreadResult =>
    RESUMABLE_THREAD_STATUSES.has(thread.status ?? ''),
  );
}

async function resolveTrajectoryResumeTarget(
  deps: EvalRunDeps,
  params: {
    runId: string;
    testCaseId: string;
    threadId?: string;
  },
) {
  log(
    'resolveTrajectoryResumeTarget: run=%s testCase=%s thread=%s',
    params.runId,
    params.testCaseId,
    params.threadId,
  );
  const loaded = await loadTrajectoryData(deps, params.runId, params.testCaseId);
  if ('error' in loaded) {
    throw new Error(loaded.error);
  }

  const { envPrompt, environment, run, testCase } = loaded;
  const runTopic = await deps.runTopicModel.findByRunAndTestCase(params.runId, params.testCaseId);
  if (!runTopic?.topicId) throw new Error('RunTopic topicId is required');

  log(
    'resolveTrajectoryResumeTarget: topicId=%s runTopic.status=%s',
    runTopic.topicId,
    runTopic.status,
  );

  let thread: Awaited<ReturnType<ThreadModel['findById']>> | undefined;

  if (params.threadId) {
    thread = await deps.threadModel.findById(params.threadId);
    if (!thread) throw new Error('Thread not found');
  }

  const { danglingIds, parentMessageId } = await resolveResumeParentMessageId(deps, {
    threadId: thread?.id,
    topicId: runTopic.topicId,
  });

  log(
    'resolveTrajectoryResumeTarget: parentMessageId=%s danglingIds=%d',
    parentMessageId,
    danglingIds.length,
  );

  // Remove dangling partial messages before resume so the context engine (which
  // re-fetches all topic messages after every tool-call batch) cannot include them.
  if (danglingIds.length > 0) {
    log(
      'resolveTrajectoryResumeTarget: deleting %d dangling messages: %O',
      danglingIds.length,
      danglingIds,
    );
    await deps.messageModel.deleteMessages(danglingIds);
  }

  return {
    appContext: thread
      ? { threadId: thread.id, topicId: runTopic.topicId }
      : { topicId: runTopic.topicId },
    caseId: getCaseId(testCase.metadata),
    envPrompt,
    parentMessageId,
    run,
    runTopic,
    thread,
    environment,
    topicId: runTopic.topicId,
  };
}

async function resolveResumeParentMessageId(
  deps: EvalRunDeps,
  params: { threadId?: string; topicId: string },
) {
  log('resolveResumeParentMessageId: topicId=%s threadId=%s', params.topicId, params.threadId);
  const messages = await deps.messageModel.query({
    threadId: params.threadId,
    topicId: params.topicId,
  });

  log('resolveResumeParentMessageId: total messages=%d', messages.length);
  log(
    'resolveResumeParentMessageId: messages (role, id, contentLen, parentId) = %O',
    messages.map((m) => ({
      role: m.role,
      id: m.id,
      contentLen: m.content?.length ?? 0,
      parentId: (m as any).parentId ?? null,
    })),
  );

  // Strategy:
  // - tool results are always complete (atomic, written after execution succeeds)
  // - assistant messages may be partial (LLM stream interrupted mid-way)
  // So: prefer the last tool result with content as the resume point.
  // Only fall back to assistant / user if no tool result exists.

  let parentMessageId: string | undefined;

  // Pass 1: find the last tool result with content
  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index];
    if (message.role === 'tool' && message.content) {
      log(
        'resolveResumeParentMessageId: found via tool id=%s contentLen=%d',
        message.id,
        message.content.length,
      );
      parentMessageId = message.id;
      break;
    }
  }

  // Pass 2: no tool result — fall back to last substantive assistant, then user
  if (!parentMessageId) {
    for (let index = messages.length - 1; index >= 0; index--) {
      const message = messages[index];

      if (message.role === 'assistant') {
        if (!message.content || message.content === LOADING_FLAT) {
          log('resolveResumeParentMessageId: skip empty/loading assistant msgId=%s', message.id);
          continue;
        }
        log(
          'resolveResumeParentMessageId: fallback via assistant id=%s contentLen=%d',
          message.id,
          message.content.length,
        );
        parentMessageId = message.id;
        break;
      }

      if (message.role === 'user') {
        log('resolveResumeParentMessageId: fallback via user id=%s', message.id);
        parentMessageId = message.id;
        break;
      }
    }
  }

  if (!parentMessageId) throw new Error('Unable to resolve a valid resume parent message');

  // Build the valid ancestor chain from parentMessageId up to root.
  // Return danglingIds for the caller to delete — keeping this method side-effect-free.
  const parentIdMap = new Map<string, string | null>();
  for (const m of messages) {
    parentIdMap.set(m.id, (m as any).parentId ?? null);
  }

  const ancestorSet = new Set<string>();
  let cursor: string | null = parentMessageId;
  while (cursor) {
    ancestorSet.add(cursor);
    cursor = parentIdMap.get(cursor) ?? null;
  }

  const danglingIds = messages.map((m) => m.id).filter((id) => !ancestorSet.has(id));

  return { danglingIds, parentMessageId };
}

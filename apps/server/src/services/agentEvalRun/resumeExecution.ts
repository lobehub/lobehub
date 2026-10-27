import type { EvalThreadResult } from '@lobechat/types';
import { RequestTrigger } from '@lobechat/types';

import { AiAgentService } from '@/server/services/aiAgent';
import {
  AgentEvalRunWorkflow,
  type ResumeAgentTrajectoryPayload,
  type ResumeThreadTrajectoryPayload,
} from '@/server/workflows/agentEvalRun';

import { recordTrajectoryCompletion } from './completion';
import { createEvalRunDeps } from './deps';
import { canResumeTrajectory } from './resumeTarget';
import { recordThreadCompletion } from './thread';
import type { EvalRunDeps } from './types';
import { getEvalContextParams, log } from './utils';

const resetResumedThreadResult = (thread: EvalThreadResult): EvalThreadResult => ({
  threadId: thread.threadId,
  status: thread.status === 'external' ? 'external' : 'running',
});

/**
 * Resume a timed-out single-agent trajectory (pass@1).
 * Claims the runTopic via CAS (timeout → running) for idempotency, then
 * calls execAgent with resume=true so the runtime continues from parentMessageId.
 */
export async function executeResumedTrajectory(
  deps: EvalRunDeps,
  params: ResumeAgentTrajectoryPayload,
) {
  const {
    appContext,
    envPrompt,
    maxSteps,
    parentMessageId,
    runId,
    targetAgentId,
    testCaseId,
    topicId,
    environment,
  } = params;

  const resumeCheck = await canResumeTrajectory(deps, { runId, testCaseId });
  if (!resumeCheck.canResume) {
    return { reason: resumeCheck.reason, status: 'cancelled' as const, topicId };
  }

  // Look up the pre-created RunTopic and reset it for resume
  log(
    'executeResumedTrajectory: run=%s testCase=%s topicId=%s parentMessageId=%s',
    runId,
    testCaseId,
    topicId,
    parentMessageId,
  );
  const runTopic = await deps.runTopicModel.findByRunAndTestCase(runId, testCaseId);
  if (!runTopic) {
    throw new Error(`RunTopic not found for run=${runId} testCase=${testCaseId}`);
  }

  // Capture accumulated telemetry from previous runs before clearing evalResult
  const prevSteps = runTopic.evalResult?.steps ?? 0;
  const prevCost = runTopic.evalResult?.cost ?? 0;
  const prevLlmCalls = runTopic.evalResult?.llmCalls ?? 0;
  const prevToolCalls = runTopic.evalResult?.toolCalls ?? 0;
  const prevTokens = runTopic.evalResult?.tokens ?? 0;
  log('executeResumedTrajectory: prev telemetry steps=%d cost=%d', prevSteps, prevCost);
  const now = new Date();

  await deps.runTopicModel.updateByRunAndTopic(runId, topicId, {
    createdAt: now, // reset for timeout tracking — resume is a fresh time window
    evalResult: null,
    passed: null,
    score: null,
    status: 'running',
  });

  await deps.runModel.update(runId, { startedAt: now, status: 'running' });

  const aiAgentService = new AiAgentService(deps.db, deps.userId, {
    workspaceId: deps.workspaceId,
  });
  const webhookUrl = '/api/workflows/agent-eval-run/on-trajectory-complete';
  const userId = deps.userId;
  const db = deps.db;

  try {
    const execResult = await aiAgentService.execAgent({
      agentId: targetAgentId,
      appContext,
      autoStart: true,
      trigger: RequestTrigger.Eval,
      hooks: [
        {
          handler: async (event) => {
            // Local mode: directly record completion
            await recordTrajectoryCompletion(createEvalRunDeps(db, userId, deps.workspaceId), {
              runId,
              status: event.status || event.reason || 'done',
              telemetry: {
                completionReason: event.reason,
                cost: (event.cost ?? 0) + prevCost,
                duration: event.duration,
                errorDetail: event.errorDetail,
                errorMessage: event.errorMessage,
                // `event.llmCalls` is already cumulative: the operation is seeded with
                // `initialLlmCalls: prevLlmCalls`.
                llmCalls: event.llmCalls ?? 0,
                steps: (event.steps ?? 0) + prevSteps,
                toolCalls: (event.toolCalls ?? 0) + prevToolCalls,
                totalTokens: (event.totalTokens ?? 0) + prevTokens,
              },
              testCaseId,
            });
          },
          id: 'eval-trajectory-complete',
          type: 'onComplete' as const,
          webhook: {
            body: { runId, testCaseId, userId },
            delivery: 'qstash' as const,
            url: webhookUrl,
          },
        },
      ],
      ...getEvalContextParams(envPrompt, environment, params.caseId),
      initialLlmCalls: prevLlmCalls,
      initialStepCount: prevSteps,
      maxSteps,
      parentMessageId,
      prompt: '',
      resume: true,
      userInterventionConfig: { approvalMode: 'headless' },
    });

    if (execResult?.operationId) {
      await deps.runTopicModel.updateByRunAndTopic(runId, topicId, {
        evalResult: { operationId: execResult.operationId, rubricScores: [] },
      });
    }

    return { status: 'started' as const, topicId };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Agent execution failed to start';
    console.error(
      `[resume-agent-trajectory] execAgent failed for run=${runId} testCase=${testCaseId}:`,
      error,
    );

    // Record error and finalize the run if all test cases are done
    const { allDone } = await recordTrajectoryCompletion(deps, {
      runId,
      status: 'error',
      telemetry: { completionReason: 'error', errorMessage },
      testCaseId,
    });

    if (allDone) {
      await AgentEvalRunWorkflow.triggerFinalizeRun({ runId, userId: deps.userId });
    }

    return { reason: errorMessage, status: 'error' as const, topicId };
  }
}

/**
 * Resume a timed-out thread trajectory (pass@k).
 * Claims the runTopic via CAS (timeout → running) for idempotency, then
 * calls execAgent with resume=true so the runtime continues from parentMessageId.
 */
export async function executeResumedThreadTrajectory(
  deps: EvalRunDeps,
  params: ResumeThreadTrajectoryPayload,
) {
  const {
    appContext,
    caseId,
    envPrompt,
    maxSteps,
    parentMessageId,
    runId,
    targetAgentId,
    testCaseId,
    threadId,
    environment,
    topicId,
  } = params;

  const resumeCheck = await canResumeTrajectory(deps, { runId, testCaseId, threadId });
  if (!resumeCheck.canResume) {
    return { reason: resumeCheck.reason, status: 'cancelled' as const, threadId, topicId };
  }

  // Look up the pre-created RunTopic and reset it for resume
  const runTopic = await deps.runTopicModel.findByRunAndTestCase(runId, testCaseId);
  if (!runTopic) {
    throw new Error(`RunTopic not found for run=${runId} testCase=${testCaseId}`);
  }

  const currentThread = await deps.threadModel.findById(threadId);
  const currentThreadMeta = (currentThread?.metadata ?? {}) as Record<string, unknown>;
  const prevThreads = runTopic.evalResult?.threads ?? [];
  const nextThreads = prevThreads.some((thread) => thread.threadId === threadId)
    ? prevThreads.map((thread) =>
        thread.threadId === threadId ? resetResumedThreadResult(thread) : thread,
      )
    : [...prevThreads, { status: 'running' as const, threadId }];

  // Capture accumulated telemetry from the target thread only
  const prevSteps = (currentThreadMeta.steps as number | undefined) ?? 0;
  const prevCost = (currentThreadMeta.cost as number | undefined) ?? 0;
  const prevLlmCalls = (currentThreadMeta.llmCalls as number | undefined) ?? 0;
  const prevToolCalls = (currentThreadMeta.toolCalls as number | undefined) ?? 0;
  const prevTokens = (currentThreadMeta.tokens as number | undefined) ?? 0;
  const now = new Date();

  await deps.runTopicModel.updateByRunAndTopic(runId, topicId, {
    createdAt: now,
    evalResult: { threads: nextThreads },
    passed: null,
    score: null,
    status: 'running',
  });

  await deps.threadModel.update(threadId, {
    metadata: { testCaseId } as any,
  });

  await deps.runModel.update(runId, { startedAt: now, status: 'running' });

  const aiAgentService = new AiAgentService(deps.db, deps.userId, {
    workspaceId: deps.workspaceId,
  });
  const webhookUrl = '/api/workflows/agent-eval-run/on-thread-complete';
  const userId = deps.userId;
  const db = deps.db;

  try {
    const execResult = await aiAgentService.execAgent({
      agentId: targetAgentId,
      appContext,
      autoStart: true,
      trigger: RequestTrigger.Eval,
      hooks: [
        {
          handler: async (event) => {
            // Local mode: directly record thread completion
            await recordThreadCompletion(createEvalRunDeps(db, userId, deps.workspaceId), {
              runId,
              status: event.status || event.reason || 'done',
              telemetry: {
                completionReason: event.reason,
                cost: (event.cost ?? 0) + prevCost,
                duration: event.duration,
                errorMessage: event.errorMessage,
                // `event.llmCalls` is already cumulative: the operation is seeded with
                // `initialLlmCalls: prevLlmCalls`.
                llmCalls: event.llmCalls ?? 0,
                steps: (event.steps ?? 0) + prevSteps,
                toolCalls: (event.toolCalls ?? 0) + prevToolCalls,
                totalTokens: (event.totalTokens ?? 0) + prevTokens,
              },
              testCaseId,
              threadId,
              topicId,
            });
          },
          id: 'eval-thread-complete',
          type: 'onComplete' as const,
          webhook: {
            body: { runId, testCaseId, threadId, topicId, userId },
            delivery: 'qstash' as const,
            url: webhookUrl,
          },
        },
      ],
      ...getEvalContextParams(envPrompt, environment, caseId),
      initialLlmCalls: prevLlmCalls,
      initialStepCount: prevSteps,
      maxSteps,
      parentMessageId,
      prompt: '',
      resume: true,
      userInterventionConfig: { approvalMode: 'headless' },
    });

    // Write operationId to thread metadata
    if (execResult?.operationId) {
      await deps.threadModel.update(threadId, {
        metadata: { operationId: execResult.operationId, testCaseId } as any,
      });
    }

    return { status: 'started' as const, threadId, topicId };
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : 'Thread execution failed to start';
    console.error(
      `[resume-thread-trajectory] execAgent failed for run=${runId} thread=${threadId}:`,
      error,
    );

    // Record error and finalize the run if all test cases are done
    const { allRunDone } = await recordThreadCompletion(deps, {
      runId,
      status: 'error',
      telemetry: { completionReason: 'error', errorMessage },
      testCaseId,
      threadId,
      topicId,
    });

    if (allRunDone) {
      await AgentEvalRunWorkflow.triggerFinalizeRun({ runId, userId: deps.userId });
    }

    return { reason: errorMessage, status: 'error' as const, threadId, topicId };
  }
}

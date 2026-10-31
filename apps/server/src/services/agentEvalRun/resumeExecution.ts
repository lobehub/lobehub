import { RequestTrigger } from '@lobechat/types';

import { AiAgentService } from '@/server/services/aiAgent';
import {
  AgentEvalRunWorkflow,
  type ResumeAgentTrajectoryPayload,
  type ResumeThreadTrajectoryPayload,
} from '@/server/workflows/agentEvalRun';

import { contenderChatConfigOf } from './caseAgent';
import { recordTrajectoryCompletion } from './completion';
import { createEvalRunDeps } from './deps';
import { canResumeTrajectory } from './resumeTarget';
import { interruptEvalOperations } from './runLifecycle';
import { recordThreadCompletion } from './thread';
import { prepareTrialMemory } from './trialMemory';
import type { EvalRunDeps } from './types';
import { getEvalAttemptId, getEvalContextParams, log } from './utils';

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
  const executionId = crypto.randomUUID();
  const claimed = await deps.runTopicModel.claimExecution({
    executionId,
    expectedExecutionId: params.expectedExecutionId,
    resume: true,
    runId,
    testCaseId,
    topicId,
  });
  if (!claimed) return { reason: 'Resume target changed', status: 'cancelled' as const, topicId };
  const runTopic = claimed.parent;

  // Capture accumulated telemetry from previous runs before clearing evalResult
  const prevSteps = runTopic.evalResult?.steps ?? 0;
  const prevCost = runTopic.evalResult?.cost ?? 0;
  const prevLlmCalls = runTopic.evalResult?.llmCalls ?? 0;
  const prevToolCalls = runTopic.evalResult?.toolCalls ?? 0;
  const prevTokens = runTopic.evalResult?.tokens ?? 0;
  log('executeResumedTrajectory: prev telemetry steps=%d cost=%d', prevSteps, prevCost);
  const bindOperation = async (operationId: string) => {
    const saved = await deps.runTopicModel.mergeExecutionResult(runId, topicId, executionId, {
      operationId,
    });
    if (!saved) {
      await interruptEvalOperations(deps, [operationId]);
      throw new Error('Execution is no longer current');
    }
  };

  const aiAgentService = new AiAgentService(deps.db, deps.userId, {
    workspaceId: deps.workspaceId,
  });
  const webhookUrl = '/api/workflows/agent-eval-run/on-trajectory-complete';
  const userId = deps.userId;
  const db = deps.db;

  try {
    const memory = await prepareTrialMemory(deps, { environment, runId, testCaseId, topicId });
    const execResult = await aiAgentService.execAgent({
      agentId: targetAgentId,
      appContext: { ...appContext, suppressSignal: true },
      autoStart: true,
      chatConfigOverride: contenderChatConfigOf(await deps.runModel.findById(runId)),
      trigger: RequestTrigger.Eval,
      hooks: [
        {
          handler: async (event) => {
            // Local mode: directly record completion
            const { allDone } = await recordTrajectoryCompletion(
              createEvalRunDeps(db, userId, deps.workspaceId),
              {
                executionId,
                topicId,
                runId,
                status: event.status || event.reason || 'done',
                telemetry: {
                  completionReason: event.reason,
                  cost: (event.cost ?? 0) + prevCost,
                  duration: event.duration,
                  errorDetail: event.errorDetail,
                  errorMessage: event.errorMessage,
                  // The seeded operation already reports a cumulative LLM call count.
                  llmCalls: event.llmCalls ?? 0,
                  steps: (event.steps ?? 0) + prevSteps,
                  toolCalls: (event.toolCalls ?? 0) + prevToolCalls,
                  totalTokens: (event.totalTokens ?? 0) + prevTokens,
                },
                testCaseId,
              },
            );
            // Queue mode finalizes from the completion webhook; in-process runs
            // have only this handler, so the run must be finalized here.
            if (allDone) await AgentEvalRunWorkflow.triggerFinalizeRun({ runId, userId });
          },
          id: 'eval-trajectory-complete',
          type: 'onComplete' as const,
          webhook: {
            body: { executionId, runId, testCaseId, topicId, userId },
            delivery: 'qstash' as const,
            url: webhookUrl,
          },
        },
      ],
      ...getEvalContextParams(
        envPrompt,
        environment,
        params.caseId,
        memory,
        getEvalAttemptId({ runId, topicId }),
      ),
      initialLlmCalls: prevLlmCalls,
      onOperationCreated: bindOperation,
      initialStepCount: prevSteps,
      maxSteps,
      parentMessageId,
      prompt: '',
      resume: true,
      userInterventionConfig: { approvalMode: 'headless' },
    });

    if (execResult?.operationId) {
      await bindOperation(execResult.operationId);
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
      executionId,
      topicId,
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
  const executionId = crypto.randomUUID();
  const claimed = await deps.runTopicModel.claimExecution({
    executionId,
    expectedExecutionId: params.expectedExecutionId,
    resume: true,
    runId,
    testCaseId,
    threadId,
    topicId,
  });
  if (!claimed)
    return { reason: 'Resume target changed', status: 'cancelled' as const, threadId, topicId };
  const currentThread = claimed.thread;
  const currentThreadMeta = (currentThread?.metadata ?? {}) as Record<string, unknown>;
  // Capture accumulated telemetry from the target thread only
  const prevSteps = (currentThreadMeta.steps as number | undefined) ?? 0;
  const prevCost = (currentThreadMeta.cost as number | undefined) ?? 0;
  const prevLlmCalls = (currentThreadMeta.llmCalls as number | undefined) ?? 0;
  const prevToolCalls = (currentThreadMeta.toolCalls as number | undefined) ?? 0;
  const prevTokens = (currentThreadMeta.tokens as number | undefined) ?? 0;
  const bindOperation = async (operationId: string) => {
    const saved = await deps.runTopicModel.updateThreadMetadata(
      runId,
      topicId,
      threadId,
      { operationId },
      { executionId },
    );
    if (!saved) {
      await interruptEvalOperations(deps, [operationId]);
      throw new Error('Execution is no longer current');
    }
  };

  const aiAgentService = new AiAgentService(deps.db, deps.userId, {
    workspaceId: deps.workspaceId,
  });
  const webhookUrl = '/api/workflows/agent-eval-run/on-thread-complete';
  const userId = deps.userId;
  const db = deps.db;

  try {
    const memory = await prepareTrialMemory(deps, {
      environment,
      runId,
      testCaseId,
      threadId,
      topicId,
    });
    const execResult = await aiAgentService.execAgent({
      agentId: targetAgentId,
      appContext: { ...appContext, suppressSignal: true },
      autoStart: true,
      chatConfigOverride: contenderChatConfigOf(await deps.runModel.findById(runId)),
      trigger: RequestTrigger.Eval,
      hooks: [
        {
          handler: async (event) => {
            // Local mode: directly record thread completion
            const { allRunDone } = await recordThreadCompletion(
              createEvalRunDeps(db, userId, deps.workspaceId),
              {
                executionId,
                runId,
                status: event.status || event.reason || 'done',
                telemetry: {
                  completionReason: event.reason,
                  cost: (event.cost ?? 0) + prevCost,
                  duration: event.duration,
                  errorMessage: event.errorMessage,
                  // The seeded operation already reports a cumulative LLM call count.
                  llmCalls: event.llmCalls ?? 0,
                  steps: (event.steps ?? 0) + prevSteps,
                  toolCalls: (event.toolCalls ?? 0) + prevToolCalls,
                  totalTokens: (event.totalTokens ?? 0) + prevTokens,
                },
                testCaseId,
                threadId,
                topicId,
              },
            );
            // Queue mode finalizes from the completion webhook; in-process runs
            // have only this handler, so the run must be finalized here.
            if (allRunDone) await AgentEvalRunWorkflow.triggerFinalizeRun({ runId, userId });
          },
          id: 'eval-thread-complete',
          type: 'onComplete' as const,
          webhook: {
            body: { executionId, runId, testCaseId, threadId, topicId, userId },
            delivery: 'qstash' as const,
            url: webhookUrl,
          },
        },
      ],
      ...getEvalContextParams(
        envPrompt,
        environment,
        caseId,
        memory,
        getEvalAttemptId({ runId, threadId, topicId }),
      ),
      initialLlmCalls: prevLlmCalls,
      onOperationCreated: bindOperation,
      initialStepCount: prevSteps,
      maxSteps,
      parentMessageId,
      prompt: '',
      resume: true,
      userInterventionConfig: { approvalMode: 'headless' },
    });

    // Write operationId to thread metadata
    if (execResult?.operationId) {
      await bindOperation(execResult.operationId);
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
      executionId,
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

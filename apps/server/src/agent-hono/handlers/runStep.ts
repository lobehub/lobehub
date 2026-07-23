import {
  context as otelContext,
  SpanStatusCode,
  trace as otelTrace,
} from '@lobechat/observability-otel/api';
import { tracer as agentRuntimeTracer } from '@lobechat/observability-otel/modules/agent-runtime';
import debug from 'debug';
import { eq } from 'drizzle-orm';
import type { Context } from 'hono';

import { getServerDB } from '@/database/core/db-adaptor';
import { agentOperations } from '@/database/schemas/agentOperations';
import { AgentRuntimeCoordinator } from '@/server/modules/AgentRuntime';
import {
  AgentStepTimeoutError,
  DEFAULT_AGENT_STEP_DEADLINE_MS,
  isAgentStepTimeoutError,
  raceWithAgentStepSignal,
} from '@/server/modules/AgentRuntime/stepDeadline';
import { AiAgentService } from '@/server/services/aiAgent';

const log = debug('lobe-server:agent:run-step');

const toIsoString = (value: Date | string | null | undefined): null | string => {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString();
  return value;
};

const getQStashMessageId = (c: Context): string | undefined =>
  c.req.header('upstash-message-id') ??
  c.req.header('upstash-messageid') ??
  c.req.header('message-id');

const resolveAgentStepTimeoutError = (error: unknown): AgentStepTimeoutError | undefined => {
  if (isAgentStepTimeoutError(error)) return error;
  if (error instanceof Error && isAgentStepTimeoutError(error.cause)) return error.cause;

  return undefined;
};

async function getOperationRowDiagnostic(operationId: string) {
  try {
    const serverDB = await getServerDB();
    const [row] = await serverDB
      .select({
        completedAt: agentOperations.completedAt,
        startedAt: agentOperations.startedAt,
        status: agentOperations.status,
        stepCount: agentOperations.stepCount,
        traceS3Key: agentOperations.traceS3Key,
      })
      .from(agentOperations)
      .where(eq(agentOperations.id, operationId))
      .limit(1);

    return {
      completedAt: toIsoString(row?.completedAt),
      exists: Boolean(row),
      startedAt: toIsoString(row?.startedAt),
      status: row?.status ?? null,
      stepCount: row?.stepCount ?? null,
      traceS3KeyPresent: Boolean(row?.traceS3Key),
    };
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : String(error),
      exists: null,
      status: null,
    };
  }
}

interface CreateRunStepHandlerOptions {
  stepDeadlineMs?: number;
}

/**
 * Execute a single agent step. Invoked by QStash with the body
 * `{ operationId, stepIndex, context, humanInput?, approvedToolCall?, ... }`.
 *
 * Auth: `qstashAuth` on the route — QStash signature required.
 */
export const createRunStepHandler = ({
  stepDeadlineMs = DEFAULT_AGENT_STEP_DEADLINE_MS,
}: CreateRunStepHandlerOptions = {}) => {
  return async (c: Context): Promise<Response> => {
    const startTime = Date.now();
    const deadlineAt = startTime + stepDeadlineMs;
    const controller = new AbortController();
    const qstashMessageId = getQStashMessageId(c);
    const upstashRetried = c.req.header('upstash-retried') ?? null;
    const externalRetryCount = Number(upstashRetried ?? 0) || 0;
    let body: any;
    let currentStage = 'request.parse';
    let currentStageStartedAt = startTime;
    let operationId: string | undefined;
    let queueWaitMs: number | undefined;
    let stepIndex = 0;

    const runStepSpan = agentRuntimeTracer.startSpan('agent.run_step', {
      attributes: {
        'agent.step.deadline_at': deadlineAt,
        'agent.step.qstash_retried': externalRetryCount,
      },
    });
    const runStepContext = otelTrace.setSpan(otelContext.active(), runStepSpan);
    const reportStage = (stage: string) => {
      const now = Date.now();
      currentStage = stage;
      currentStageStartedAt = now;
      runStepSpan.addEvent('agent.run_step.stage', {
        'agent.step.elapsed_ms': now - startTime,
        'agent.step.stage': stage,
      });
    };
    const timeoutId = setTimeout(
      () => {
        const now = Date.now();
        const spanContext = runStepSpan.spanContext();
        const timeoutError = new AgentStepTimeoutError({
          deadlineAt,
          stage: currentStage,
          stageElapsedMs: now - currentStageStartedAt,
        });

        // Emit before aborting: some ownership-changing writes and post-commit
        // cleanup are deliberately not promise-raced. If one never returns,
        // the handler catch and span end below will not run before the platform
        // hard timeout, so this is the last reliable execution snapshot.
        console.warn(
          JSON.stringify({
            deadlineAt,
            elapsedMs: now - startTime,
            event: 'agent.run_step.deadline_reached',
            operationId,
            qstashMessageId,
            queueWaitMs,
            spanId: spanContext.spanId,
            stage: currentStage,
            stageElapsedMs: timeoutError.stageElapsedMs,
            stepIndex,
            traceId: spanContext.traceId,
            upstashRetried,
          }),
        );

        controller.abort(timeoutError);
      },
      Math.max(0, deadlineAt - Date.now()),
    );

    try {
      return await otelContext.with(runStepContext, async () => {
        try {
          body = await c.req.json();
        } catch {
          return c.json({ error: 'Invalid JSON body' }, 400);
        }

        try {
          // QStash nests resume/intervention fields under `body.payload` (see
          // QStashQueueServiceImpl.scheduleMessage), while `operationId`/`stepIndex`/
          // `context` stay at the top level. Merge so both shapes work — without this
          // the QStash path reads `resumeAsyncTool`/`approvedToolCall`/… as undefined
          // and never resumes a parked op. (The local queue spreads payload itself.)
          const mergedBody = { ...body, ...body.payload };
          const {
            approvedToolCall,
            asyncToolVerifyAttempt,
            context,
            finishAfterAsyncTool,
            groupMemberTimeout,
            humanInput,
            rejectAndContinue,
            rejectionReason,
            resumeAsyncTool,
            toolMessageId,
            verifyAsyncToolBarrier,
          } = mergedBody;
          operationId = mergedBody.operationId;
          stepIndex = mergedBody.stepIndex ?? 0;
          queueWaitMs =
            typeof body.timestamp === 'number' && Number.isFinite(body.timestamp)
              ? Math.max(0, startTime - body.timestamp)
              : undefined;

          runStepSpan.setAttributes({
            ...(operationId && { 'agent.operation.id': operationId }),
            ...(qstashMessageId && { 'agent.step.qstash_message_id': qstashMessageId }),
            ...(queueWaitMs !== undefined && { 'agent.step.queue_wait_ms': queueWaitMs }),
            'agent.step.index': stepIndex,
          });

          if (!operationId) {
            return c.json({ error: 'operationId is required' }, 400);
          }

          log(`[${operationId}] Starting step ${stepIndex}`);

          reportStage('metadata.load');
          const coordinator = new AgentRuntimeCoordinator();
          const metadata = await raceWithAgentStepSignal(
            coordinator.getOperationMetadata(operationId),
            controller.signal,
          );

          if (!metadata?.userId) {
            reportStage('metadata.diagnostic');
            const dbRow = await raceWithAgentStepSignal(
              getOperationRowDiagnostic(operationId),
              controller.signal,
            );
            const diagnostic = {
              dbRow,
              event: 'agent.run_step.missing_operation_metadata',
              metadataHasUserId: Boolean(metadata?.userId),
              metadataPresent: Boolean(metadata),
              operationId,
              qstashMessageId,
              stepIndex,
              upstashRetried,
            };

            log(`[${operationId}] Invalid operation or no userId found: %O`, diagnostic);
            console.warn(JSON.stringify(diagnostic));
            return c.json({ error: 'Invalid operation or unauthorized' }, 401);
          }

          reportStage('database.connect');
          const serverDB = await raceWithAgentStepSignal(getServerDB(), controller.signal);
          // Step through AiAgentService so the runtime keeps its `execSubAgent`
          // fork callback (needed by `lobe-agent.callSubAgent`). In QStash mode every
          // step is a fresh HTTP request, and a bare AgentRuntimeService would lose the
          // in-process callback → SUB_AGENT_UNAVAILABLE.
          //
          // Thread the operation's workspace through so the runtime's models stay
          // workspace-scoped. Without it the worker is personal-scoped and the
          // parent-message lookup misses workspace-scoped rows → ConversationParentMissing.
          const aiAgentService = new AiAgentService(serverDB, metadata.userId, {
            workspaceId: metadata.workspaceId,
          });

          reportStage('runtime.execute');
          const result = await aiAgentService.executeStep({
            approvedToolCall,
            asyncToolVerifyAttempt,
            context,
            deadlineAt,
            externalRetryCount,
            finishAfterAsyncTool,
            groupMemberTimeout,
            humanInput,
            onStage: reportStage,
            operationId,
            rejectAndContinue,
            rejectionReason,
            resumeAsyncTool,
            signal: controller.signal,
            stepIndex,
            toolMessageId,
            verifyAsyncToolBarrier,
          });

          // A non-stale lock conflict means another delivery is still executing this
          // operation. Keep the response retryable so QStash redelivers this step.
          if (result.locked) {
            log(`[${operationId}] Step ${stepIndex} locked by another instance, returning 429`);
            return c.json(
              { error: 'Step is currently being executed, retry later', operationId, stepIndex },
              429,
              { 'Retry-After': '37' },
            );
          }

          const executionTime = Date.now() - startTime;
          const responseData = {
            completed: result.state.status === 'done',
            error: result.state.status === 'error' ? result.state.error : undefined,
            executionTime,
            nextStepIndex: result.nextStepScheduled ? stepIndex + 1 : undefined,
            nextStepScheduled: result.nextStepScheduled,
            operationId,
            pendingApproval: result.state.pendingToolsCalling,
            pendingPrompt: result.state.pendingHumanPrompt,
            pendingSelect: result.state.pendingHumanSelect,
            status: result.state.status,
            stepIndex,
            success: result.success,
            totalCost: result.state.cost?.total || 0,
            totalSteps: result.state.stepCount,
            waitingForHuman: result.state.status === 'waiting_for_human',
          };

          log(
            `[${operationId}] Step ${stepIndex} completed (${executionTime}ms, status: ${result.state.status})`,
          );

          return c.json(responseData);
        } catch (error: unknown) {
          const executionTime = Date.now() - startTime;
          const timeoutError = resolveAgentStepTimeoutError(error);

          if (timeoutError) {
            const spanContext = runStepSpan.spanContext();
            const diagnostic = {
              deadlineAt: timeoutError.deadlineAt,
              elapsedMs: executionTime,
              event: 'agent.run_step.timeout',
              handled: timeoutError.handled,
              operationId,
              qstashMessageId,
              queueWaitMs,
              spanId: spanContext.spanId,
              stage: timeoutError.stage,
              stageElapsedMs: timeoutError.stageElapsedMs,
              stepIndex,
              traceId: spanContext.traceId,
              upstashRetried,
            };
            console.warn(JSON.stringify(diagnostic));
          }

          // A handled timeout has completed the service's durable error
          // finalization and must ACK QStash. Unhandled timeouts (including an
          // error-state save failure carried as `cause`) fall through to 500 so
          // the same delivery remains retryable.
          if (timeoutError?.handled) {
            runStepSpan.recordException(timeoutError);
            runStepSpan.setStatus({ code: SpanStatusCode.ERROR, message: timeoutError.message });

            return c.json(
              {
                error: timeoutError.message,
                errorType: timeoutError.errorType,
                executionTime,
                operationId,
                stage: timeoutError.stage,
                stepIndex,
                success: false,
              },
              200,
            );
          }

          console.error('Error in execution: %O', error);
          const traceError = new Error('Agent step execution failed');
          traceError.name = error instanceof Error ? error.name : 'Error';
          runStepSpan.recordException(traceError);
          runStepSpan.setStatus({
            code: SpanStatusCode.ERROR,
            message: traceError.message,
          });

          return c.json(
            {
              error: error instanceof Error ? error.message : String(error),
              executionTime,
              operationId,
              stepIndex,
            },
            500,
          );
        }
      });
    } finally {
      clearTimeout(timeoutId);
      runStepSpan.end();
    }
  };
};

export const runStep = createRunStepHandler();

/**
 * Health check for the agent execution path.
 */
export function runStepHealth(c: Context): Response {
  return c.json({
    healthy: true,
    message: 'Agent execution service is running',
    timestamp: new Date().toISOString(),
  });
}

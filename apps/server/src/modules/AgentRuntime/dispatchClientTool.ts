import type { ChatToolPayload } from '@lobechat/types';
import debug from 'debug';

import type { ToolExecutionResultResponse } from '@/server/services/toolExecution/types';

import { getAgentRuntimeRedisClient } from './redis';
import { GLOBAL_DEFAULT_TIMEOUT_MS, MAX_TIMEOUT_MS, MIN_TIMEOUT_MS } from './resolveToolTimeout';
import {
  getAgentStepAbortReason,
  raceWithAgentStepSignal,
  throwIfAgentStepAborted,
} from './stepDeadline';
import type { ToolResultPayload } from './ToolResultWaiter';
import { ToolResultWaiter } from './ToolResultWaiter';
import type { IStreamEventManager } from './types';

const log = debug('lobe-server:agent-runtime:dispatch-client-tool');

interface DispatchContext {
  agentId?: string | null;
  /** Assistant message that carries this tool call. */
  assistantMessageId?: string;
  /** Absolute deadline of the containing step. */
  deadlineAt?: number;
  documentId?: string | null;
  groupId?: string | null;
  operationId: string;
  rootOperationId?: string;
  scope?: string | null;
  /** Cooperative cancellation inherited from the containing step. */
  signal?: AbortSignal;
  sourceMessageId?: string | null;
  streamManager: IStreamEventManager;
  taskId?: string | null;
  threadId?: string | null;
  /**
   * Per-call execution budget in milliseconds, normally produced by
   * `resolveToolTimeoutMs`. When omitted, falls back to the global default
   * (`GLOBAL_DEFAULT_TIMEOUT_MS`). Configuration is clamped to
   * `[MIN_TIMEOUT_MS, MAX_TIMEOUT_MS]`, then reduced to the containing step's
   * remaining budget when necessary.
   */
  timeoutMs?: number;
  topicId?: string | null;
}

const clampTimeout = (value: number, deadlineAt?: number): number => {
  const configuredTimeout = Math.min(Math.max(Math.trunc(value), MIN_TIMEOUT_MS), MAX_TIMEOUT_MS);

  if (deadlineAt === undefined) return configuredTimeout;

  return Math.min(configuredTimeout, Math.max(1, Math.trunc(deadlineAt - Date.now())));
};

const buildTimeoutResult = (executionTime: number): ToolExecutionResultResponse => ({
  content: '',
  error: { message: 'Tool execution timed out', type: 'timeout' },
  executionTime,
  success: false,
});

const buildErrorResult = (
  executionTime: number,
  error: unknown,
  type = 'dispatch_failed',
): ToolExecutionResultResponse => ({
  content: '',
  error: {
    message: error instanceof Error ? error.message : String(error),
    type,
  },
  executionTime,
  success: false,
});

/**
 * Dispatch a tool execution to the client via Agent Gateway WebSocket and
 * block-await the result on Redis. Never throws: any error path produces a
 * failed ClientToolExecutionResult so the agent loop can continue.
 *
 * The caller is expected to gate on `typeof streamManager.sendToolExecute ===
 * 'function'` and `chatToolPayload.executor === 'client'` before invoking.
 */
export async function dispatchClientTool(
  chatToolPayload: ChatToolPayload,
  ctx: DispatchContext,
): Promise<ToolExecutionResultResponse> {
  const { operationId, streamManager } = ctx;
  const startedAt = Date.now();

  throwIfAgentStepAborted(ctx.signal);

  if (typeof streamManager.sendToolExecute !== 'function') {
    return buildErrorResult(
      0,
      'Gateway notifier does not support tool_execute',
      'gateway_unsupported',
    );
  }

  const redis = getAgentRuntimeRedisClient();
  if (!redis) {
    return buildErrorResult(
      0,
      'Redis is not available for tool result waiting',
      'redis_unavailable',
    );
  }

  // BLPOP holds the underlying socket, so we need a dedicated connection per
  // dispatch. Cleanup in `finally` so we never leak on the error path.
  const blockingClient = redis.duplicate();
  const waiter = new ToolResultWaiter(blockingClient, redis);

  const timeoutMs = clampTimeout(ctx.timeoutMs ?? GLOBAL_DEFAULT_TIMEOUT_MS, ctx.deadlineAt);

  try {
    log(
      '[%s] dispatching client tool %s/%s (toolCallId=%s, timeout=%dms)',
      operationId,
      chatToolPayload.identifier,
      chatToolPayload.apiName,
      chatToolPayload.id,
      timeoutMs,
    );

    await raceWithAgentStepSignal(
      streamManager.sendToolExecute(operationId, {
        agentId: ctx.agentId,
        apiName: chatToolPayload.apiName,
        arguments: chatToolPayload.arguments,
        assistantMessageId: ctx.assistantMessageId,
        documentId: ctx.documentId,
        executionTimeoutMs: timeoutMs,
        groupId: ctx.groupId,
        identifier: chatToolPayload.identifier,
        rootOperationId: ctx.rootOperationId ?? operationId,
        scope: ctx.scope,
        sourceMessageId: ctx.sourceMessageId,
        taskId: ctx.taskId,
        threadId: ctx.threadId,
        toolCallId: chatToolPayload.id,
        topicId: ctx.topicId,
      }),
      ctx.signal,
    );

    const result = await raceWithAgentStepSignal(
      waiter.waitForResult(chatToolPayload.id, timeoutMs),
      ctx.signal,
    );
    const executionTime = Date.now() - startedAt;

    if (!result) {
      log(
        '[%s] client tool %s timed out after %dms',
        operationId,
        chatToolPayload.id,
        executionTime,
      );
      return buildTimeoutResult(executionTime);
    }

    return projectToExecutionResult(result, executionTime);
  } catch (error) {
    if (ctx.signal?.aborted) throw getAgentStepAbortReason(ctx.signal);

    const executionTime = Date.now() - startedAt;
    log('[%s] client tool dispatch failed: %O', operationId, error);
    return buildErrorResult(executionTime, error);
  } finally {
    blockingClient.disconnect();
  }
}

function projectToExecutionResult(
  payload: ToolResultPayload,
  executionTime: number,
): ToolExecutionResultResponse {
  return {
    content: payload.content ?? '',
    error: payload.error,
    executionTime,
    state: payload.state,
    success: payload.success,
    // Forward the client-relayed Work registration intent so the agent runtime
    // loop calls `registerWork` (the persist path strips it — never hits the DB).
    workRegistration: payload.workRegistration,
  };
}

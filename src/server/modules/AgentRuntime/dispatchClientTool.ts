import type { ChatToolPayload } from '@lobechat/types';
import debug from 'debug';

import type { ToolExecutionResultResponse } from '@/server/services/toolExecution/types';

import { getAgentRuntimeRedisClient } from './redis';
import type { ToolResultPayload } from './ToolResultWaiter';
import { ToolResultWaiter } from './ToolResultWaiter';
import type { IStreamEventManager } from './types';

const log = debug('lobe-server:agent-runtime:dispatch-client-tool');

/**
 * Default per-tool execution budget when the payload doesn't carry one.
 */
const DEFAULT_EXECUTION_TIMEOUT_MS = 60_000;

/**
 * Hard cap tied to a single Vercel serverless function window. Phase 6.3c
 * relaxes this by persisting pending-tool state and resuming on a fresh
 * invocation.
 */
const MAX_EXECUTION_TIMEOUT_MS = 270_000;

interface DispatchContext {
  operationId: string;
  streamManager: IStreamEventManager;
}

const clampTimeout = (value: number): number =>
  Math.min(Math.max(value, 1_000), MAX_EXECUTION_TIMEOUT_MS);

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

  const timeoutMs = clampTimeout(DEFAULT_EXECUTION_TIMEOUT_MS);

  try {
    log(
      '[%s] dispatching client tool %s/%s (toolCallId=%s, timeout=%dms)',
      operationId,
      chatToolPayload.identifier,
      chatToolPayload.apiName,
      chatToolPayload.id,
      timeoutMs,
    );

    await streamManager.sendToolExecute(operationId, {
      apiName: chatToolPayload.apiName,
      arguments: chatToolPayload.arguments,
      executionTimeoutMs: timeoutMs,
      identifier: chatToolPayload.identifier,
      toolCallId: chatToolPayload.id,
    });

    const result = await waiter.waitForResult(chatToolPayload.id, timeoutMs);
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
    success: payload.success,
  };
}

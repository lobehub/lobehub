import type { AfterToolCallHookEvent, ToolRunResult } from '@lobechat/agent-runtime';
import type { MessageMetadata, SerializedAgentHook } from '@lobechat/types';
import {
  BLOCKED_TOOL_RESULT_CONTENT,
  pickToolResultUsage,
} from '@lobechat/utils/toolResultControl';

import type { HookDispatcher } from './HookDispatcher';

export { BLOCKED_TOOL_RESULT_CONTENT } from '@lobechat/utils/toolResultControl';

export interface ToolResultControlOutcome {
  blocked: boolean;
  cancelled: boolean;
  result: ToolRunResult;
  /** Trusted runtime verdict, separate from tool-owned result fields. */
  review?: NonNullable<MessageMetadata['toolResultControl']>;
}

/**
 * The tool has already executed. Replace its entire model-facing result, rather
 * than only the text: state/error/Work data may contain the same denied output.
 * Never echo a receiver-provided reason, which may quote the protected result.
 */
export function blockedToolResult(result: ToolRunResult, preserveUsage = false): ToolRunResult {
  return {
    content: BLOCKED_TOOL_RESULT_CONTENT,
    deviceExecutionTime: result.deviceExecutionTime,
    error: 'hook_denied',
    executionTime: result.executionTime,
    state: {
      ...(preserveUsage && pickToolResultUsage(result.state)),
      phase: 'afterToolCall',
      reason: BLOCKED_TOOL_RESULT_CONTENT,
      type: 'blocked',
    },
    ...(result.stop !== undefined && { stop: result.stop }),
    success: false,
  };
}

/** One shared gate for immediate and out-of-band tool completions. */
export async function controlToolResult(
  dispatcher: HookDispatcher | undefined,
  event: AfterToolCallHookEvent,
  hooks?: SerializedAgentHook[],
  signal?: AbortSignal,
  preserveUsage = false,
): Promise<ToolResultControlOutcome> {
  const reviewed = dispatcher?.hasAfterToolCallControl(event.operationId, hooks, event);
  const decision = await dispatcher?.evaluateAfterToolCall(event.operationId, event, hooks, signal);
  if (signal?.aborted || decision?.status === 'cancelled') {
    return {
      blocked: true,
      cancelled: true,
      result: blockedToolResult(event.result, preserveUsage),
    };
  }
  return {
    blocked: decision?.status === 'blocked',
    cancelled: false,
    result:
      decision?.status === 'blocked'
        ? blockedToolResult(event.result, preserveUsage)
        : event.result,
    ...(reviewed && {
      review: {
        operationId: event.operationId,
        callIndex: event.callIndex,
        stepIndex: event.stepIndex,
        status: decision?.status === 'blocked' ? 'blocked' : 'allowed',
      },
    }),
  };
}

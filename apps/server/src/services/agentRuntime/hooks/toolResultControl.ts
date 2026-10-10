import type { AfterToolCallHookEvent, ToolRunResult } from '@lobechat/agent-runtime';
import type { SerializedAgentHook } from '@lobechat/types';
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
}

/**
 * The tool has already executed. Replace its entire model-facing result, rather
 * than only the text: state/error/Work data may contain the same denied output.
 * The hook's denial reason is the replacement content; discard the original output.
 */
export function blockedToolResult(
  result: ToolRunResult,
  {
    preserveUsage = false,
    reason = BLOCKED_TOOL_RESULT_CONTENT,
  }: { preserveUsage?: boolean; reason?: string } = {},
): ToolRunResult {
  return {
    content: reason,
    deviceExecutionTime: result.deviceExecutionTime,
    error: 'hook_denied',
    executionTime: result.executionTime,
    state: {
      ...(preserveUsage && pickToolResultUsage(result.state)),
      phase: 'afterToolCall',
      reason,
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
  {
    preserveUsage = false,
    includeServerHooks = true,
  }: {
    preserveUsage?: boolean;
    includeServerHooks?: boolean;
  } = {},
): Promise<ToolResultControlOutcome> {
  const decision = await dispatcher?.evaluateAfterToolCall(
    event.operationId,
    event,
    hooks,
    signal,
    includeServerHooks,
  );
  if (signal?.aborted || decision?.status === 'cancelled') {
    return {
      blocked: true,
      cancelled: true,
      result: blockedToolResult(event.result, { preserveUsage }),
    };
  }
  return {
    blocked: decision?.status === 'blocked',
    cancelled: false,
    result:
      decision?.status === 'blocked'
        ? blockedToolResult(event.result, { preserveUsage, reason: decision.reason })
        : event.result,
  };
}

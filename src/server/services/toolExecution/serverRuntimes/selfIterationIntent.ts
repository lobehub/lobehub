import { SELF_ITERATION_INTENT_IDENTIFIER } from '@lobechat/builtin-tool-self-iteration';
import { nanoid } from '@lobechat/utils';

import { enqueueAgentSignalSourceEvent } from '@/server/services/agentSignal';
import type { DeclareSelfIterationIntentPayload } from '@/server/services/agentSignal/services/selfIterationIntent';
import { createSelfIterationIntentService } from '@/server/services/agentSignal/services/selfIterationIntent';

import type { ToolExecutionContext, ToolExecutionResult } from '../types';
import type { ServerRuntimeRegistration } from './types';

type SelfIterationIntentToolResultContent = {
  accepted: boolean;
  reason: null | string;
  sourceId: null | string;
  strength: 'strong' | 'weak';
};

const createJsonResult = (
  content: SelfIterationIntentToolResultContent,
  success: boolean,
): ToolExecutionResult => ({
  content: JSON.stringify(content),
  success,
});

const sharedSelfIterationIntentService = createSelfIterationIntentService({
  enqueueSource: (sourceEvent) =>
    enqueueAgentSignalSourceEvent(sourceEvent, {
      agentId: sourceEvent.payload.agentId,
      userId: sourceEvent.payload.userId,
    }),
  nextToolCallId: () => nanoid(),
});

/**
 * Server runtime for advisory self-iteration intent declarations.
 *
 * Use when:
 * - A running agent calls declareSelfIterationIntent
 * - The server should enqueue Agent Signal source events without mutating resources directly
 *
 * Expects:
 * - Tool execution context includes `agentId`, `userId`, and `topicId`
 * - `operationId` and `toolCallId` are used when present for stable source identity
 *
 * Returns:
 * - JSON tool content with accepted status, source id, strength, and rejection reason
 */
class SelfIterationIntentRuntime {
  declareSelfIterationIntent = async (
    input: DeclareSelfIterationIntentPayload,
    context: ToolExecutionContext,
  ): Promise<ToolExecutionResult> => {
    const { agentId, operationId, toolCallId, topicId, userId } = context;

    if (!agentId || !userId || !topicId) {
      return {
        content: JSON.stringify({
          accepted: false,
          reason: 'missing_context',
          required: ['agentId', 'userId', 'topicId'],
        }),
        success: false,
      };
    }

    const result = await sharedSelfIterationIntentService.declareIntent({
      agentId,
      input,
      operationId,
      toolCallId,
      topicId,
      userId,
    });

    return createJsonResult(
      {
        accepted: result.accepted,
        reason: result.reason ?? null,
        sourceId: result.sourceId ?? null,
        strength: result.strength,
      },
      true,
    );
  };
}

/**
 * Registers the self-iteration intent builtin server runtime.
 *
 * Use when:
 * - BuiltinToolsExecutor needs to resolve the injected declaration tool
 *
 * Expects:
 * - Per-call method validation handles required runtime context
 *
 * Returns:
 * - A lightweight runtime instance for the current execution
 */
export const selfIterationIntentRuntime: ServerRuntimeRegistration = {
  factory: () => new SelfIterationIntentRuntime(),
  identifier: SELF_ITERATION_INTENT_IDENTIFIER,
};

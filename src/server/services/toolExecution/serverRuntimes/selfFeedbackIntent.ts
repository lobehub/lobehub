import { SELF_FEEDBACK_INTENT_IDENTIFIER } from '@lobechat/builtin-tool-self-iteration';
import { nanoid } from '@lobechat/utils';

import { enqueueAgentSignalSourceEvent } from '@/server/services/agentSignal';
import type { DeclareSelfFeedbackIntentPayload } from '@/server/services/agentSignal/services/selfFeedbackIntent';
import { createSelfFeedbackIntentService } from '@/server/services/agentSignal/services/selfFeedbackIntent';

import type { ToolExecutionContext, ToolExecutionResult } from '../types';
import type { ServerRuntimeRegistration } from './types';

type SelfFeedbackIntentToolResultContent = {
  accepted: boolean;
  reason: null | string;
  sourceId: null | string;
  strength: 'strong' | 'weak';
};

const createJsonResult = (
  content: SelfFeedbackIntentToolResultContent,
  success: boolean,
): ToolExecutionResult => ({
  content: JSON.stringify(content),
  success,
});

const sharedSelfFeedbackIntentService = createSelfFeedbackIntentService({
  enqueueSource: (sourceEvent) =>
    enqueueAgentSignalSourceEvent(sourceEvent, {
      agentId: sourceEvent.payload.agentId,
      userId: sourceEvent.payload.userId,
    }),
  nextToolCallId: () => nanoid(),
});

/**
 * Server runtime for advisory self-feedback intent declarations.
 *
 * Use when:
 * - A running agent calls declareSelfFeedbackIntent
 * - The server should enqueue Agent Signal source events without mutating resources directly
 *
 * Expects:
 * - Tool execution context includes `agentId`, `userId`, and `topicId`
 * - `operationId` and `toolCallId` are used when present for stable source identity
 *
 * Returns:
 * - JSON tool content with accepted status, source id, strength, and rejection reason
 */
class SelfFeedbackIntentRuntime {
  declareSelfFeedbackIntent = async (
    input: DeclareSelfFeedbackIntentPayload,
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

    const result = await sharedSelfFeedbackIntentService.declareIntent({
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
 * Registers the self-feedback intent builtin server runtime.
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
export const selfFeedbackIntentRuntime: ServerRuntimeRegistration = {
  factory: () => new SelfFeedbackIntentRuntime(),
  identifier: SELF_FEEDBACK_INTENT_IDENTIFIER,
};

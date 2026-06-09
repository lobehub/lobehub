import { SELF_FEEDBACK_INTENT_IDENTIFIER } from '@lobechat/builtin-tool-self-iteration';
import { SelfFeedbackIntentExecutionRuntime } from '@lobechat/builtin-tool-self-iteration/executionRuntime';
import { nanoid } from '@lobechat/utils';

import { enqueueAgentSignalSourceEvent } from '@/server/services/agentSignal';
import { createSelfFeedbackIntentService } from '@/server/services/agentSignal/services/selfFeedbackIntent';

import type { ServerRuntimeRegistration } from './types';

const sharedSelfFeedbackIntentService = createSelfFeedbackIntentService({
  enqueueSource: (sourceEvent) =>
    enqueueAgentSignalSourceEvent(sourceEvent, {
      agentId: sourceEvent.payload.agentId,
      userId: sourceEvent.payload.userId,
    }),
  nextToolCallId: () => nanoid(),
});

const runtime = new SelfFeedbackIntentExecutionRuntime({
  service: sharedSelfFeedbackIntentService,
});

/**
 * Registers the self-feedback intent builtin server runtime.
 *
 * Use when:
 * - A running agent calls declareSelfFeedbackIntent
 * - The server should enqueue Agent Signal source events without mutating resources directly
 * - BuiltinToolsExecutor needs to resolve the injected declaration tool
 *
 * Expects:
 * - The package ExecutionRuntime validates per-call `agentId`, `userId`, and `topicId`
 * - The shared service preserves fast-loop declaration rate limits
 *
 * Returns:
 * - A shared runtime instance backed by the server Agent Signal enqueue boundary
 */
export const selfFeedbackIntentRuntime: ServerRuntimeRegistration = {
  factory: () => runtime,
  identifier: SELF_FEEDBACK_INTENT_IDENTIFIER,
};

import { SELF_FEEDBACK_INTENT_IDENTIFIER } from '@lobechat/builtin-tool-self-iteration';
import { SelfFeedbackIntentExecutionRuntime } from '@lobechat/builtin-tool-self-iteration/executionRuntime';
import { nanoid } from '@lobechat/utils';

import { enqueueAgentSignalSourceEvent } from '@/server/services/agentSignal';
import {
  createRedisDeclarationLimiter,
  createSelfFeedbackIntentService,
} from '@/server/services/agentSignal/services/selfFeedbackIntent';

import type { ToolExecutionContext } from '../types';
import type { ServerRuntimeRegistration } from './types';

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
 * - The shared service enforces the per-scope declaration limit through Redis (the limiter
 *   state lives in Redis, so rebuilding it per request preserves the cross-process limit)
 *
 * Returns:
 * - A per-request runtime backed by the server Agent Signal enqueue boundary. Built per call
 *   because `enqueueAgentSignalSourceEvent` resolves agent ownership through the run's
 *   `workspaceId` — a workspace agent enqueued without it fails the `assertAgentUsableBy`
 *   personal-mode lookup and the tool reports "Agent not found" (see T-888).
 */
export const selfFeedbackIntentRuntime: ServerRuntimeRegistration = {
  factory: (context: ToolExecutionContext) =>
    new SelfFeedbackIntentExecutionRuntime({
      service: createSelfFeedbackIntentService({
        declarationLimiter: createRedisDeclarationLimiter(),
        enqueueSource: (sourceEvent) =>
          enqueueAgentSignalSourceEvent(sourceEvent, {
            agentId: sourceEvent.payload.agentId,
            userId: sourceEvent.payload.userId,
            workspaceId: context.workspaceId,
          }),
        nextToolCallId: () => nanoid(),
      }),
    }),
  identifier: SELF_FEEDBACK_INTENT_IDENTIFIER,
};

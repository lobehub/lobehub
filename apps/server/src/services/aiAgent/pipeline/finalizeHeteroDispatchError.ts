import type { LobeChatDatabase } from '@lobechat/database';
import type {
  ChatErrorDispatchContext,
  DeviceUnavailableErrorData,
  ErrorType,
} from '@lobechat/types';
import { ChatErrorType } from '@lobechat/types';
import debug from 'debug';

import type { MessageModel } from '@/database/models/message';
import type { TopicModel } from '@/database/models/topic';
import { createStreamEventManager } from '@/server/modules/AgentRuntime/factory';
import { CompletionLifecycle } from '@/server/services/agentRuntime/CompletionLifecycle';
import { hookDispatcher } from '@/server/services/agentRuntime/hooks';

import type { DeviceDispatchRoute } from '../helpers/heteroErrors';

const log = debug('lobe-server:ai-agent-service');

/** The part of `HeteroDispatchDeps` that settling a dispatch failure needs. */
export interface HeteroDispatchErrorDeps {
  db: LobeChatDatabase;
  messageModel: MessageModel;
  topicModel: TopicModel;
  userId: string;
  workspaceId?: string;
}

/**
 * Finalize a hetero run that fails *synchronously at dispatch* — before the
 * CLI/agent process ever starts (device offline → DEVICE_NOT_FOUND, no bound
 * device, access denied, sandbox spawn rejected). These paths never produce a
 * `heteroFinish` (CLI exit) or `agentNotify` done callback, so without this
 * each one would strand the run: the assistant bubble would show an error but
 * the UI stream would never close and a long-run task would hang in `running`.
 *
 * Routes through the SAME terminal funnel a normal exit uses —
 * `CompletionLifecycle.completeOperation` finalizes the op row and fires the
 * run's onComplete/onError hooks, so the task lifecycle (onTopicComplete → task
 * failed) and any IM bot completion callback fire exactly as they would for a
 * real failure — then closes the UI stream and clears the (never-started)
 * running operation. The hooks were registered and serialized onto
 * `runningOperation` at dispatch time.
 *
 * Stream-close / hook dispatch / metadata clear are best-effort: a failure
 * there must not mask the original dispatch error the caller surfaces.
 *
 * Returns whether an `onComplete` consumer was there to be told. Callers hand
 * that back to the invoker as `terminalReported` so a surface that renders
 * failures itself (the IM bot bridge) can tell "the lifecycle already announced
 * this" from "nobody did" — see {@link HookDispatcher.canDeliver}.
 */
export const finalizeHeteroDispatchError = async (
  deps: HeteroDispatchErrorDeps,
  params: {
    agentId?: string;
    assistantMessageId: string;
    detail: string;
    /**
     * Allowlisted cause of the dispatch failure. Unlike `detail`, it also rides
     * on the lifecycle error, so completion hooks (the IM bot reply) can name
     * the cause without receiving the free-form text.
     */
    dispatch?: ChatErrorDispatchContext;
    /** The device this dispatch was routed to, when it was a device dispatch. */
    deviceRoute?: DeviceDispatchRoute;
    errorData?: DeviceUnavailableErrorData;
    /**
     * Client error type. Defaults to the generic `ServerAgentRuntimeError`; pass a
     * dedicated `ChatErrorType` (e.g. `DeviceGatewayNotConfigured`) so the web
     * client renders a specific localized headline instead of the generic copy.
     */
    errorType?: ErrorType;
    message: string;
    operationId: string;
    topicId: string;
  },
): Promise<boolean> => {
  const {
    agentId,
    assistantMessageId,
    detail,
    deviceRoute,
    dispatch,
    errorData,
    errorType = ChatErrorType.ServerAgentRuntimeError,
    message,
    operationId,
    topicId,
  } = params;

  // 1. Error bubble — written first so a stream subscriber reacting to the
  //    end event below re-reads a message that already carries the error.
  await deps.messageModel.update(assistantMessageId, {
    content: '',
    error: {
      body: { detail, ...errorData, ...(dispatch && { dispatch }) },
      message,
      type: errorType,
    },
  });

  // 1b. Finalize the run through CompletionLifecycle's single entry — the SAME
  //     owner the CLI exit (heteroFinish) / in-process paths use. It marks the
  //     agent_operations row terminal (the row was inserted at recordStart, but a
  //     dispatch failure goes through THIS path, not heteroFinish, so without
  //     finalizing it the row stays status='running' forever) AND fires the run's
  //     onComplete/onError hooks (task lifecycle → task failed + IM bot callback).
  //     `skipErrorMessageWrite` keeps the bespoke device-specific bubble written
  //     in step 1; verify is done-only, so it no-ops on this error path.
  //     Read BEFORE dispatching: a settled lifecycle unregisters the operation's
  //     hooks, so asking afterwards can no longer tell "delivered" from "never
  //     had one".
  const terminalReported = hookDispatcher.canDeliver(operationId, 'onComplete');
  await new CompletionLifecycle(deps.db, deps.userId, deps.workspaceId).completeOperation(
    {
      agentId,
      assistantMessageId,
      error: {
        message,
        type: errorType,
        ...(deviceRoute && { deviceRoute }),
        ...(dispatch && { body: { dispatch } }),
      },
      operationId,
      serializedHooks: hookDispatcher.getSerializedHooks(operationId),
      topicId,
      userId: deps.userId,
    },
    'error',
    { skipErrorMessageWrite: true },
  );

  // 2. Close the UI stream.
  try {
    await createStreamEventManager().publishAgentRuntimeEnd({
      finalState: { error: detail },
      operationId,
      reason: 'error',
      reasonDetail: detail,
      stepIndex: 0,
    });
  } catch (err) {
    log('finalizeHeteroDispatchError: publishAgentRuntimeEnd failed (non-fatal): %O', err);
  }

  // 3. The operation never started — settle the topic so reconnect /
  //    heteroIngest validation and the next turn don't see a stale operation.
  //    Settle, not take: dropping the marker alone would strand `status` on
  //    'running' with nothing left for any later settle to match — see
  //    `ServerOperationStore.clearRunningMark`. 'active' rather than 'unread'
  //    because a dispatch that never started produced nothing to read.
  try {
    await deps.topicModel.settleRunningOperation(topicId, operationId, 'active');
  } catch (err) {
    log('finalizeHeteroDispatchError: clear runningOperation failed (non-fatal): %O', err);
  }

  return terminalReported;
};

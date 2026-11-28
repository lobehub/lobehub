import type { AgentState } from '@lobechat/agent-runtime';
import type { CallSubAgentState } from '@lobechat/builtin-tool-lobe-agent';
import { appendSubAgentReference, isCallSubAgentCall } from '@lobechat/builtin-tool-lobe-agent';
import debug from 'debug';

import {
  extractTextFromMessage,
  findLastAssistantMessage,
  normalizeCompletionMessages,
} from '../CompletionLifecycle';
import {
  type AgentExecutionResult,
  type SubAgentBridgeParams,
  type SubAgentTimeoutParams,
} from '../types';
import { scheduleRunWatchdog } from './runWatchdog';
import type { AgentRuntimeServiceContext } from './types';
import { formatErrorForMetadata, formatSubAgentErrorReason } from './utils';

const log = debug('lobe-server:agent-runtime-service');

/** What this module reads off the service. */
export type SubAgentBridgeDeps = Pick<
  AgentRuntimeServiceContext,
  | 'baseURL'
  | 'completeSubAgentBridge'
  | 'controlCompletedToolResult'
  | 'coordinator'
  | 'delegate'
  | 'interruptOperation'
  | 'isCallSubAgentToolMessage'
  | 'messageModel'
  | 'queueService'
  | 'resolveLastAssistantContentFromThread'
  | 'resolveLastAssistantMessageFromDB'
  | 'streamManager'
  | 'tryResumeParentFromAsyncTool'
>;

/**
 * Stream a `callSubAgent` child's running totals to the client, once per step.
 *
 * Addressed to the PARENT's operationId, not the child's: the client opens one
 * WebSocket per operation and never subscribes to the child's channel. The
 * parent's channel is still live because parking at `waiting_for_async_tool`
 * deliberately does not publish a stream-end event (see
 * `AgentRuntimeCoordinator.STREAM_END_STATUSES`).
 *
 * Rides `step_complete` rather than a new event type because `AgentStreamEventType`
 * is a closed union shared with the out-of-repo gateway worker; `phase` is the
 * established discriminator and unknown phases are ignored by older clients.
 *
 * The three stat fields are read from exactly the same state paths that
 * `completeSubAgentBridge` uses for its final backfill, so the live numbers
 * converge on the persisted ones instead of jumping when the run ends.
 *
 * Best-effort: a publish failure must not fail the sub-agent's step.
 */
export async function publishSubAgentProgress(
  deps: SubAgentBridgeDeps,
  state: AgentState,
  stepIndex: number,
): Promise<void> {
  const anchor = state?.origin?.lineage?.progressAnchor as
    { parentOperationId: string; toolMessageId: string } | undefined;
  if (!anchor?.parentOperationId || !anchor.toolMessageId) return;

  try {
    await deps.streamManager.publishStreamEvent(anchor.parentOperationId, {
      data: {
        model: state?.modelRuntimeConfig?.model,
        phase: 'subagent_progress',
        toolMessageId: anchor.toolMessageId,
        totalCost: state?.cost?.total,
        totalInputTokens: state?.usage?.llm?.tokens?.input,
        totalOutputTokens: state?.usage?.llm?.tokens?.output,
        totalTokens: state?.usage?.llm?.tokens?.total,
        totalToolCalls: state?.usage?.tools?.totalCalls,
      },
      stepIndex,
      type: 'step_complete',
    });
  } catch (error) {
    log('[%s] failed to publish sub-agent progress (non-fatal): %O', state?.operationId, error);
  }
}

/**
 * Sub-agent completion bridge for the server `callSubAgent` deferred-tool
 * path. Runs when a child sub-agent op reaches a terminal state — invoked
 * in-process by the child's `onComplete` hook handler (local mode) or via
 * the QStash-delivered `/webhooks/subagent-callback` endpoint (queue mode,
 * where in-memory handler hooks don't survive cross-process steps).
 *
 *   1. Backfill the parent's placeholder tool message with the sub-agent's
 *      final answer (success) or an error note (failure), plus pluginState
 *      so the UI render can resolve the isolation thread.
 *   2. Resume the parked parent: barrier-check + CAS via
 *      `tryResumeParentFromAsyncTool`, arming the delayed verify when the
 *      parent isn't resumable yet.
 *
 * THROWS on infrastructure failure of either half (state load, backfill,
 * resume) so the queue-mode callback returns non-2xx and QStash redelivers
 * the whole bridge — the delayed verify alone cannot recover a failed
 * backfill, it only re-reads the barrier. Redelivery is safe: the backfill
 * rewrites the same content and the resume is CAS-guarded.
 *
 * Returns true when this call won the resume CAS.
 */
export async function completeSubAgentBridge(
  deps: SubAgentBridgeDeps,
  params: SubAgentBridgeParams,
): Promise<boolean> {
  const { operationId, parentOperationId, reason, threadId, toolMessageId } = params;
  const timedOut = reason === 'timeout';
  const failed = timedOut || reason === 'error' || reason === 'interrupted';

  // Infra errors propagate; a null state (expired) degrades to a stub note.
  const finalState =
    params.finalState ?? (await deps.coordinator.loadAgentState(operationId)) ?? undefined;

  log(
    '[%s] sub-agent bridge → parent %s (reason: %s, state: %s)',
    operationId,
    parentOperationId,
    reason,
    finalState ? 'loaded' : 'missing',
  );

  // 1. Backfill the placeholder tool message with the result.
  // `updateToolMessage` swallows transaction errors into `success: false`,
  // so the flag must be checked — an unfulfilled message would hold the
  // parent's barrier forever while the callback acked with 200.
  //
  // A state loaded via the fallback above arrives without `messages` (the
  // persisted Redis blob no longer carries them — see
  // AgentStateManager.serializeStateForPersist). Resolve the final leaf from
  // the parsed DB conversation, then recover the original row by id so its
  // serialized content stays paired with metadata.isMultimodal. An in-process
  // params.finalState already carries messages and skips this query.
  let lastAssistant: unknown;
  if (!failed && finalState && !Array.isArray(finalState.messages)) {
    try {
      lastAssistant = await deps.resolveLastAssistantMessageFromDB(finalState);
    } catch (error) {
      console.error(
        '[%s] sub-agent bridge: failed to resolve final assistant from DB: %O',
        operationId,
        error,
      );
    }
  }
  const messages = Array.isArray(finalState?.messages) ? finalState.messages : [];
  lastAssistant ??= findLastAssistantMessage(normalizeCompletionMessages(messages));
  let lastAssistantContent = extractTextFromMessage(lastAssistant);

  // Gated on `!finalState`, not merely an empty `lastAssistantContent`: a
  // real (authoritative) final state whose last turn is legitimately
  // textless (image-only, or the "preserve an empty leaf" case in
  // `normalizeCompletionMessages`) must keep the stub below, not go dig
  // through the thread's own message history — a lagging read could
  // surface an EARLIER real reply from the same thread and silently show
  // stale text instead of the correct empty-answer signal. `!finalState`
  // is exactly the case this fallback exists for: heterogeneous (CLI-driven)
  // children never populate it at all (see
  // `resolveLastAssistantContentFromThread`'s doc comment), so there is no
  // authoritative signal here to override.
  if (!failed && !finalState && threadId) {
    try {
      lastAssistantContent = await deps.resolveLastAssistantContentFromThread(threadId);
    } catch (error) {
      console.error(
        '[%s] sub-agent bridge: failed to resolve content from thread %s: %O',
        operationId,
        threadId,
        error,
      );
    }
  }
  const errorReason = failed
    ? formatSubAgentErrorReason(finalState?.error ?? params.errorMessage)
    : undefined;
  // A timed-out child is stopped mid-task, so what it said last is the only
  // progress the parent can read without a follow-up. Best-effort: the thread
  // read is the same fallback the success path uses for a state without messages.
  let partialAnswer: string | undefined;
  if (timedOut && threadId) {
    try {
      partialAnswer = await deps.resolveLastAssistantContentFromThread(threadId);
    } catch (error) {
      log('[%s] sub-agent bridge: failed to read progress before timeout: %O', operationId, error);
    }
  }
  const resultContent = timedOut
    ? formatSubAgentTimeoutResult(params.errorMessage, partialAnswer)
    : failed
      ? errorReason
        ? `Sub-agent did not complete (${reason}): ${errorReason}`
        : `Sub-agent did not complete (${reason}).`
      : lastAssistantContent || 'Sub-agent completed without a textual answer.';

  // A background sub-agent's parent never parked on it: the placeholder holds
  // the start receipt the parent already read, so the answer is kept for a
  // delivery of its own instead of a backfill + resume.
  const placeholderState = await readSubAgentPlaceholderState(deps, toolMessageId);
  if (placeholderState?.background === true) {
    // The timeout watchdog records its result first and interrupts the child,
    // whose own completion then lands here as `interrupted`. Unlike the
    // foreground backfill (`onlyIfEmpty`), nothing else stops that second
    // write from replacing the timeout result before it is delivered.
    if (reason === 'interrupted' && placeholderState.timedOut) {
      log('[%s] sub-agent bridge: background result already recorded as timed out', operationId);
      return false;
    }
    // The answer is published into the parent's conversation on a later turn,
    // so the result controls must run here too: otherwise an `afterToolCall`
    // policy sees the start receipt and never the finished output it could
    // deny, and both the stored answer and the message the delivery writes
    // would carry content the policy had replaced.
    const controlled = await deps.controlCompletedToolResult({
      operationId: parentOperationId,
      preserveUsage: true,
      result: {
        content: resultContent,
        error: failed
          ? formatErrorForMetadata(finalState?.error ?? params.errorMessage)
          : undefined,
        state: {
          model: finalState?.modelRuntimeConfig?.model,
          status: failed ? 'error' : 'completed',
          threadId,
          totalCost: finalState?.cost?.total,
          totalInputTokens: finalState?.usage?.llm?.tokens?.input,
          totalOutputTokens: finalState?.usage?.llm?.tokens?.output,
          totalToolCalls: finalState?.usage?.tools?.totalCalls,
          totalTokens: finalState?.usage?.llm?.tokens?.total,
        },
        success: !failed,
      },
      toolMessageId,
    });

    await recordBackgroundSubAgentResult(deps, {
      error: controlled.result.error,
      finalState,
      result: controlled.result.content,
      status: failed || controlled.blocked || controlled.cancelled ? 'error' : 'completed',
      threadId,
      timedOut,
      toolMessageId,
    });
    return false;
  }

  // callSubAgent results carry the sub-agent id so the parent can later send
  // this same sub-agent a follow-up (`callSubAgent({ subAgentId })`) — e.g.
  // to hand over what it gathered before failing — instead of redoing it.
  const content = (await deps.isCallSubAgentToolMessage(toolMessageId, threadId))
    ? appendSubAgentReference(resultContent, threadId)
    : resultContent;

  const { result: completed, blocked } = await deps.controlCompletedToolResult({
    preserveUsage: true,
    operationId: parentOperationId,
    toolMessageId,
    result: {
      content,
      success: !failed,
      error: failed ? formatErrorForMetadata(finalState?.error ?? params.errorMessage) : undefined,
      state: {
        model: finalState?.modelRuntimeConfig?.model,
        status: failed ? 'error' : 'completed',
        threadId,
        ...(timedOut && { timedOut: true }),
        // The child's spend rides on this anchor row so the parent's usage tray can
        // account for it. The tray sums per-MESSAGE usage, and the child's own
        // assistant messages live in an isolation thread the parent never loads —
        // this row is the only place the child's cost surfaces in the parent's own
        // message list.
        totalCost: finalState?.cost?.total,
        totalInputTokens: finalState?.usage?.llm?.tokens?.input,
        totalOutputTokens: finalState?.usage?.llm?.tokens?.output,
        totalToolCalls: finalState?.usage?.tools?.totalCalls,
        totalTokens: finalState?.usage?.llm?.tokens?.total,
      },
    },
  });
  const backfill = await deps.messageModel.updateToolMessage(toolMessageId, {
    content: completed.content,
    pluginError: completed.error ?? null,
    pluginState: completed.state,
    onlyIfEmpty: true,
    ...(blocked && { replacePluginState: true }),
  });
  if (!backfill.success) {
    throw new Error(
      `Sub-agent bridge: failed to backfill tool message ${toolMessageId} for parent ${parentOperationId}`,
    );
  }

  // 2. Barrier + CAS + resume the parent op (infra errors propagate too).
  // Pass the just-backfilled message id so the barrier trusts this write
  // instead of re-reading a possibly-stale replica.
  return deps.tryResumeParentFromAsyncTool(
    { parentOperationId },
    { knownFulfilledMessageId: toolMessageId, scheduleVerifyOnHold: true },
  );
}

/**
 * The bridged placeholder's plugin state. `background` is set when the call
 * was started with `runInBackground` (`callSubAgent` or `callAgent` — only
 * their runner writes the flag).
 */
async function readSubAgentPlaceholderState(
  deps: SubAgentBridgeDeps,
  toolMessageId: string,
): Promise<CallSubAgentState | undefined> {
  const plugin = await deps.messageModel.findMessagePlugin(toolMessageId);
  return plugin?.state as CallSubAgentState | undefined;
}

/**
 * Store a finished background sub-agent's answer on its placeholder, then try
 * to deliver it. The tool result (the start receipt) is left as the parent
 * read it; the answer goes into `state.result` for the delivery to carry.
 *
 * Throws when the answer cannot be stored, so the queue-mode callback is
 * redelivered. A failed delivery does not throw: the answer is stored, and
 * the next settle of the topic picks it up.
 */
async function recordBackgroundSubAgentResult(
  deps: SubAgentBridgeDeps,
  params: {
    error?: unknown;
    finalState?: AgentState;
    result: string;
    status: 'completed' | 'error';
    threadId: string;
    timedOut?: boolean;
    toolMessageId: string;
  },
): Promise<void> {
  const { error, finalState, result, status, threadId, timedOut, toolMessageId } = params;
  const state: Partial<CallSubAgentState> = {
    model: finalState?.modelRuntimeConfig?.model,
    result,
    status,
    threadId,
    ...(timedOut && { timedOut: true }),
    totalCost: finalState?.cost?.total,
    totalInputTokens: finalState?.usage?.llm?.tokens?.input,
    totalOutputTokens: finalState?.usage?.llm?.tokens?.output,
    totalToolCalls: finalState?.usage?.tools?.totalCalls,
    totalTokens: finalState?.usage?.llm?.tokens?.total,
  };

  const recorded = await deps.messageModel.updateToolMessage(toolMessageId, {
    pluginError: error,
    pluginState: state,
  });
  if (!recorded.success) {
    throw new Error(
      `Background sub-agent: failed to record the result on tool message ${toolMessageId}`,
    );
  }

  // A `cancelSubAgent` that raced this run claims the placeholder before it
  // interrupts, so the stop does not wake the parent. A run that still finished
  // with an answer hands that claim back here, once the answer is stored, so
  // the answer is delivered. A run the cancel did stop ends as an error and
  // stays suppressed. The release is conditional, so a redelivered callback or
  // the cancel's own check cannot hand back a real delivery's claim.
  if (status === 'completed') {
    await deps.messageModel.releaseCancelSuppressedDelivery([toolMessageId]);
  }

  const placeholder = await deps.messageModel.findById(toolMessageId);
  if (!placeholder?.topicId || !deps.delegate.deliverBackgroundSubAgentResults) return;

  await deps.delegate.deliverBackgroundSubAgentResults({ topicId: placeholder.topicId });
}

/**
 * Whether the bridged placeholder belongs to `lobe-agent.callSubAgent` (the
 * same bridge also serves `callAgent`, whose children cannot be continued).
 * Best-effort: a failed lookup only drops the id trailer, never the bridge.
 */
export async function isCallSubAgentToolMessage(
  deps: SubAgentBridgeDeps,
  toolMessageId: string,
  threadId: string | undefined,
): Promise<boolean> {
  if (!threadId) return false;
  try {
    return isCallSubAgentCall(await deps.messageModel.findMessagePlugin(toolMessageId));
  } catch (error) {
    log('[%s] sub-agent bridge: failed to read tool plugin: %O', toolMessageId, error);
    return false;
  }
}

const formatTimeoutDuration = (timeoutMs: number): string => {
  const minutes = Math.round(timeoutMs / 60_000);
  if (minutes >= 1) return `${minutes} minute${minutes === 1 ? '' : 's'}`;
  const seconds = Math.max(1, Math.round(timeoutMs / 1000));
  return `${seconds} second${seconds === 1 ? '' : 's'}`;
};

/**
 * The parent's tool result for a timed-out sub-agent: that it was stopped,
 * its last reply as partial progress, and that its work is kept — the
 * `<sub_agent id>` trailer the bridge appends lets the parent continue it.
 */
const formatSubAgentTimeoutResult = (
  timeoutNote: string | undefined,
  partialAnswer: string | undefined,
): string => {
  const head = `${timeoutNote ?? 'Sub-agent timed out'} and was stopped before it finished. Anything it already did is kept in its thread.`;
  return partialAnswer ? `${head}\n\nIts last reply before the timeout:\n\n${partialAnswer}` : head;
};

/**
 * Schedule the deadline of a `callSubAgent` child — the sub-agent counterpart
 * of `scheduleGroupMemberTimeout`, on the same delayed `/run` watchdog.
 */
export async function scheduleSubAgentTimeout(
  deps: SubAgentBridgeDeps,
  params: SubAgentTimeoutParams,
): Promise<void> {
  await scheduleRunWatchdog(deps, {
    delayMs: params.timeoutMs,
    operationId: params.operationId,
    payload: { subAgentTimeout: params },
  });
}

/**
 * Enforce a `callSubAgent` child's timeout. No-op once the child reached a
 * terminal state (its own completion bridge reports it). Otherwise interrupt
 * it — the run stops at its next step boundary — and report the timeout right
 * away instead of waiting for that boundary, so a waiting parent resumes now
 * and a background result is delivered now. The child's own `interrupted`
 * completion that follows changes nothing: the foreground backfill only fills
 * an empty placeholder and the resume is CAS-guarded; a background result
 * recorded as timed out is skipped.
 */
export async function handleSubAgentTimeout(
  deps: SubAgentBridgeDeps,
  params: SubAgentTimeoutParams,
): Promise<AgentExecutionResult> {
  // Narrow status read first: most watchdogs fire after the child already
  // finished, so the full state blob is loaded only when the bridge needs it.
  const status = (await deps.coordinator.loadAgentStatus(params.operationId)) as
    string | null | undefined;
  const state =
    !status || status === 'done' || status === 'error' || status === 'interrupted'
      ? null
      : await deps.coordinator.loadAgentState(params.operationId);
  if (!state) {
    log('[%s] sub-agent timeout: child already terminal (%s), no-op', params.operationId, status);
    return { nextStepScheduled: false, state: {}, success: true };
  }

  log(
    '[%s] sub-agent timeout fired after %dms, interrupting + bridging timeout to parent %s',
    params.operationId,
    params.timeoutMs,
    params.parentOperationId,
  );
  await deps.interruptOperation(params.operationId);

  const resumed = await deps.completeSubAgentBridge({
    errorMessage: `Sub-agent timed out after ${formatTimeoutDuration(params.timeoutMs)}`,
    finalState: state,
    operationId: params.operationId,
    parentOperationId: params.parentOperationId,
    reason: 'timeout',
    threadId: params.threadId,
    toolMessageId: params.toolMessageId,
  });

  return { nextStepScheduled: resumed, state: {}, success: true };
}

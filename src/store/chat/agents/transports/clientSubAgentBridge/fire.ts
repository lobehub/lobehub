import type { ConversationContext } from '@lobechat/types';
import debug from 'debug';

import { messageService } from '@/services/message';
import { threadService } from '@/services/thread';
import { messageMapKey } from '@/store/chat/utils/messageMapKey';
import { aggregateSubagentMetrics } from '@/utils/subagentMetrics';

import { backfillChildResult } from './backfill';
import { isParentResumable } from './parentGuard';
import { reconstructRegistrationFromThread, type SettledSiblingReplay } from './reconstruct';
import {
  heldCompletions,
  registry,
  releasePending,
  removeQueuedBridgePersist,
  scheduledBridgeRetries,
  trackPending,
} from './registry';
import { reviewChildResultBeforePublish } from './resultControl';
import { settleChildThread } from './settlement';
import {
  type ClientSubAgentBridgeRegistration,
  type GroupOrchestrationBridgeRegistration,
  type SubAgentBridgeOutcome,
  type SubAgentBridgeRegistration,
} from './types';

const log = debug('lobe-store:client-subagent-bridge');

/**
 * P1 (round-18): replay a SETTLED sibling reconstructed after a reload. The
 * sibling has no future terminal event of its own, so its barrier slot would
 * stay passive forever and the parent would never resume (the current child
 * releases only its own slot). The replay reads the settled thread's final
 * answer from the server (the reloaded renderer may not hold that thread's
 * message bucket) and re-fires through the full public lifecycle — CAS
 * single-fire, armed guard, idempotent backfill, persisted-coordinate
 * cleanup — with the settlement SKIPPED (the original fire already settled
 * the thread; re-settling would clobber the persisted result/error with
 * re-derived values).
 *
 * P1 (round-19): a replay failure BEFORE `fireClientSubAgentBridge` (e.g.
 * `messageService.getMessages` rejecting) used to only log — the fire's own
 * catch (which installs the retry driver) was never reached, so the sibling's
 * barrier slot stayed pending forever. The failure now schedules the same
 * bounded-burst + slow-poll retry driver the fire path uses.
 *
 * P2 (round-19): a FAILED / interrupted sibling keeps its persisted failure
 * text — the fetched assistant message (often stale pre-failure content) is
 * only used for a `done` outcome, so the failure formatting in
 * `fireRegistration` reaches the parent instead of a misleading success
 * snapshot.
 */
const replaySettledSibling = async (
  get: () => any,
  replay: SettledSiblingReplay,
): Promise<void> => {
  const key = replay.registration.childContext.threadId;
  if (!key) return;
  try {
    const { agentId, topicId } = replay.registration.childContext;
    const messages = await messageService.getMessages({
      agentId: agentId ?? null,
      skipWorks: true,
      threadId: key,
      topicId: topicId ?? null,
    });
    // A failed replay must not resurrect a stale pre-failure assistant
    // answer as the tool result: `fireRegistration`'s failure formatting
    // takes over when no `settledContent` is supplied (P2 round-19).
    const lastAssistant = messages.findLast?.((m: any) => m.role === 'assistant');
    const settledContent =
      replay.outcome.status === 'done' &&
      typeof lastAssistant?.content === 'string' &&
      lastAssistant.content
        ? lastAssistant.content
        : undefined;
    await fireClientSubAgentBridge(get, replay.registration.childContext, replay.outcome, {
      settledContent,
      settledStats: replay.stats,
      skipSettlement: true,
    });
  } catch (error) {
    // A failed replay restores its registry claim + schedules the automatic
    // retry (the fire catch), so the slot is never silently dropped. The
    // retry re-runs the WHOLE replay — the refetched answer is the piece that
    // failed, and the fire's own retry driver never engaged.
    log('bridge: settled-sibling replay failed for %s: %O', key, error);
    scheduleBridgeRetry(key, error, () => void replaySettledSibling(get, replay));
  }
};

/**
 * The automatic retry driver for a failed fire / replay (P1 round-10): a
 * bounded burst of retries first (4 × 5s×attempt), then a slow 60s poll that
 * never stops. Every exit from the fire path cancels the timer (success) or
 * reschedules it (failure) — no entry is ever left without a driver. The
 * `refire` closure carries the caller's exact re-entry (options included —
 * the bare re-fire used to drop them, P1 round-19).
 */
const scheduleBridgeRetry = (key: string, error: unknown, refire: () => void): void => {
  const previous = scheduledBridgeRetries.get(key);
  if (previous) clearTimeout(previous.timer);
  const attempt = (previous?.attempt ?? 0) + 1;
  const delay = attempt <= 4 ? 5000 * attempt : 60_000;
  const timer = setTimeout(() => {
    log('bridge scheduled retry %d firing for key %s (delay %dms)', attempt, key, delay);
    refire();
  }, delay);
  scheduledBridgeRetries.set(key, { attempt, timer });
  log('bridge retry %d scheduled in %dms for key %s (last error: %O)', attempt, delay, key, error);
};

/**
 * Options for an internal re-fire of an already-settled bridge (P1 round-18).
 */
interface FireOptions {
  /**
   * Final answer fetched from the settled sibling's thread — the reloaded
   * renderer may not hold that thread's message bucket, so the local
   * `dbMessagesMap` read in `fireRegistration` would fall back to the
   * "finished without a text answer" placeholder.
   */
  settledContent?: string;
  /**
   * The flat stats the ORIGINAL fire settled with (model / cost / tokens) —
   * re-aggregating the unloaded message bucket of a reloaded renderer would
   * zero them.
   */
  settledStats?: Record<string, number | string | undefined>;
  /**
   * The sibling was already settled by the original fire — skip
   * `updateClientTaskThreadStatus` so the persisted result / error / stats
   * are not clobbered with re-derived values.
   */
  skipSettlement?: boolean;
}

/**
 * Fire the completion bridge for a child run that just reached a terminal
 * state. Fire-and-forget: errors are logged, never thrown — a bridge failure
 * must not fail the child's own completion. Without the server bridge's
 * queue redelivery a failed claim is dropped, but a bridge only exists after
 * a park, and the failure is logged loudly for diagnosis.
 *
 * Barrier-slot lifecycle: the slot is released exactly once per registration
 * — by the settle path, only after settlement actually succeeded (or the
 * parent was found settled out-of-band, where no retry can help). The outer
 * catch restores BOTH the registry claim and the barrier slot, so the retry
 * sees the exact pre-fire state and sibling children cannot resume the
 * parent ahead of a still-pending child.
 */
export const fireClientSubAgentBridge = async (
  get: () => any,
  context: ClientSubAgentBridgeRegistration['childContext'],
  outcome: SubAgentBridgeOutcome = { status: 'done' },
  options: FireOptions = {},
): Promise<void> => {
  const key = context.threadId;
  if (!key) return;

  let registration = registry.get(key);
  let settledSiblings: SettledSiblingReplay[] = [];
  if (!registration) {
    // Post-reload path: the registry died with the renderer. The child
    // thread row still carries the persisted coordinates. A reconstruction
    // failure THROWS (P1 round-20) — it must not be conflated with "no
    // bridge on this thread": the child's terminal boundary is the only
    // production trigger for this fire, so a silent exit here would leave
    // the parent parked forever with no retry driver.
    const reconstructed = await reconstructRegistrationFromThread(
      key,
      context.topicId ?? undefined,
    ).catch((error) => {
      scheduleBridgeRetry(
        key,
        error,
        () => void fireClientSubAgentBridge(get, context, outcome, options),
      );
      return undefined;
    });
    if (!reconstructed) return;
    registration = reconstructed.registration;
    settledSiblings = reconstructed.settledSiblings;
  }
  if (!registration) return;

  // P1 (round-18): a settled sibling reconstructed alongside this fire has no
  // future terminal event — replay it now so its backfill lands and its
  // barrier slot is released. The current child's own slot is still pending,
  // so a replay can never release the barrier into a parent resume; the last
  // releaser is whichever fire completes last (this one or a replay).
  for (const replay of settledSiblings) {
    await replaySettledSibling(get, replay);
  }

  // Two-phase activation (round-6): the spawner registers BEFORE the parent's
  // runtime assembles its deferred pause — with parallel tool lanes that gap
  // can span the whole sibling execution. A fire against an unarmed
  // registration means the child reached a terminal state while the parent
  // was still actively executing, so resuming now would race the parent's own
  // deferred path (which would overwrite the resumed turn with the "still
  // running" placeholder) and would count the barrier before every parallel
  // child has even registered. Hold the claim and the slot: arming happens
  // when the parent actually parks, and the claim stays live for the retry.
  if (!registration.armed) {
    // P1 (round-7): a parallel sibling lane can keep the parent from parking
    // past this child's terminal boundary. Hold the outcome — arming replays
    // it at the park; without this the parent parks forever (the child never
    // reaches a second terminal boundary).
    heldCompletions.set(key, outcome);
    log(
      'bridge fire deferred (not armed yet): key=%s kind=%s — waiting for the parent park',
      key,
      registration.kind,
    );
    return;
  }

  try {
    await fireRegistration(get, registration, outcome, options);
    // Settlement fully succeeded — only now is the claim final. On failure
    // the registration AND its barrier slot are put back below: a terminal
    // child run has no natural re-fire, so a dropped claim would leave the
    // parent parked forever with an unsettled placeholder.
    registry.delete(key);
    // P1 (round-23): the queue entry's lifecycle also ends HERE — the
    // backfill + parent re-entry launched successfully, so a reload can no
    // longer need the coordinates. Draining only at this boundary keeps the
    // lifeline through every earlier failure ordering (persistence lost to
    // the processing guard, flush retries, in-flight cancellations).
    removeQueuedBridgePersist(key);
    // A scheduled automatic retry (P1 round-10) is now obsolete — the bridge
    // settled through this fire. Cancel it so it doesn't re-fire pointlessly.
    const pendingRetry = scheduledBridgeRetries.get(key);
    if (pendingRetry) {
      clearTimeout(pendingRetry.timer);
      scheduledBridgeRetries.delete(key);
    }
    // Clear the persisted lifeline too — a settled bridge must never re-fire
    // after a reload. Best-effort: the `processing` status check on
    // reconstruction is the real guard (the settle path flips it).
    if (registration.childContext.topicId) {
      void threadService
        .getThreads(registration.childContext.topicId)
        .then((threads) => {
          const thread = threads.find((t) => t.id === key);
          if (!thread?.metadata || !('bridge' in thread.metadata)) return;
          const { bridge: _cleared, ...rest } = thread.metadata as Record<string, unknown>;
          return threadService.updateThread(key, { metadata: rest as any });
        })
        .catch((error) => log('bridge: failed to clear persisted coordinates: %O', error));
    }
  } catch (error) {
    // Restore BOTH pieces (registry claim + barrier slot) so the retry sees
    // the exact pre-fire state. Asymmetric restore made sibling B resume the
    // parent while A's backfill was still pending: B appeared to be the last
    // child, resumed and completed the parent, and A's later retry was then
    // rejected by the non-running-parent guard before it could backfill.
    registry.set(key, registration);
    trackPending(registration);
    log('bridge failed for key %s (claim + barrier slot restored for retry): %O', key, error);
    // P1 (round-10/11): a restored claim has no driver — the child's terminal
    // boundary was the only production caller and has already completed, so
    // without a scheduled re-fire the parent stays parked forever. The driver
    // re-fires with the ORIGINAL options (P1 round-19: the bare re-fire used
    // to drop them, so a replay-initiated fire lost its skipSettlement /
    // settledStats contract and re-settled the settled sibling).
    scheduleBridgeRetry(
      key,
      error,
      () => void fireClientSubAgentBridge(get, context, outcome, options),
    );
  }
};

const fireRegistration = async (
  get: () => any,
  registration: ClientSubAgentBridgeRegistration,
  outcome: SubAgentBridgeOutcome,
  options: FireOptions = {},
): Promise<void> => {
  const childOp = get().operations[registration.childOperationId];
  const childThreadId = registration.childContext.threadId;

  // The child's final output: read from its isolation thread messages. For a
  // replayed settled sibling (P1 round-18) the bucket may not be loaded in
  // the reloaded renderer — the caller fetched the settled answer from the
  // server instead.
  const threadMessages = options.settledContent
    ? []
    : childThreadId
      ? get().dbMessagesMap[messageMapKey(registration.childContext)] || []
      : [];
  const lastAssistant = threadMessages.findLast?.((m: any) => m.role === 'assistant');

  // Preserve terminal disposition: a failed/interrupted continuation must
  // not reach the parent disguised as a successful answer (which could even
  // be stale pre-failure content). The parent sees the failure honestly.
  const succeeded = outcome.status === 'done';
  const resultContent =
    options.settledContent ??
    (succeeded
      ? lastAssistant?.content ||
        'Sub-agent finished without a text answer. Check its thread for details.'
      : outcome.error
        ? `Sub-agent run ${outcome.status === 'interrupted' ? 'was interrupted' : 'failed'}: ${outcome.error}`
        : `Sub-agent run ${outcome.status === 'interrupted' ? 'was interrupted' : 'failed'}. Check its thread for details.`);

  // Terminal stats from the child's own thread messages — the same
  // aggregation the normal completion path and the inspector chip use, so
  // the bridge (the authoritative stats writer per the CallSubAgentState
  // contract) can't diverge from the live projection. Token split and cost
  // come from the run boundary's AgentState (the per-message aggregation
  // can't see cost), matching the normal path's flat stats exactly — once
  // flat totals exist, calculateOperationUsageMetrics stops falling back to
  // the live progress object, so a missing split would report zero cost.
  // A replayed settled sibling (P1 round-18) carries the stats the ORIGINAL
  // fire settled with — re-aggregating an unloaded bucket would zero them.
  const metrics = aggregateSubagentMetrics(threadMessages);
  const stats = options.settledStats ?? {
    model: metrics.model,
    totalCost: outcome.cost,
    totalInputTokens: outcome.usage?.input,
    totalOutputTokens: outcome.usage?.output,
    totalTokens: (outcome.usage?.total ?? metrics.totalTokens) || undefined,
    totalToolCalls: metrics.toolCalls,
  };

  log(
    'bridge firing: key=%s kind=%s status=%s result=%d chars',
    childThreadId,
    registration.kind,
    outcome.status,
    resultContent.length,
  );

  // The parked child op itself never completed (parking skips terminal
  // side effects and the resume runs under a new operation) — retire it so
  // it does not linger as a zombie running op.
  if (childOp?.status === 'running') {
    get().completeOperation(registration.childOperationId);
  }

  const settleThread = (): Promise<void> =>
    settleChildThread({
      childThreadId: childThreadId!,
      metrics,
      outcome,
      resultContent,
      succeeded,
      threadMessageCount: threadMessages.length,
    });

  // P1 (round-18): a replayed settled sibling was already settled by the
  // original fire — skip the settlement so the persisted result / error /
  // stats are not clobbered with re-derived values.
  if (!options.skipSettlement) {
    await settleThread();
  }

  // P1 (round-23): run the parent's `afterToolCall` result-control BEFORE
  // any content is published (see resultControl.ts for the full contract —
  // the review failure rethrows into this fire's retry driver, fail-closed).
  const controlled = await reviewChildResultBeforePublish(
    registration,
    childThreadId,
    resultContent,
    succeeded,
    stats,
  );
  if (registration.kind === 'sub-agent') {
    await fireSubAgentBridge(
      get,
      registration,
      controlled.content,
      controlled.succeeded,
      controlled.stats,
    );
  } else {
    await fireGroupOrchestrationBridge(
      get,
      registration,
      controlled.content,
      controlled.succeeded,
      controlled.stats,
    );
  }
};

/**
 * Sub-agent kind: backfill the parent's placeholder tool message, persist the
 * authoritative completion state + thread settlement (the normal completion
 * path's step-8 shape — the parked child skipped it), then resume the parked
 * parent run from the tool message position — but only when this child is
 * the LAST pending one on the shared parent op (parallel-call barrier).
 */
const fireSubAgentBridge = async (
  get: () => any,
  registration: SubAgentBridgeRegistration,
  resultContent: string,
  succeeded: boolean,
  stats: Record<string, number | string | undefined>,
): Promise<void> => {
  const { parentContext, parentOperationId, toolMessageId } = registration;

  // Guard: the parent must still be parked on this tool. In-session the op
  // stays `running` across an async-tool park; after a reload the op is gone,
  // but the parent's tool row still carries the deferred `running` plugin
  // state — that is the durable equivalent. If either signal says the parent
  // settled out-of-band (user stopped the run, a newer run took over), a
  // phantom continuation would be worse than none — backfill only, no
  // resume. The barrier slot is released so sibling children are not blocked
  // by a dead parent.
  const parentOp = get().operations[parentOperationId];
  const parentParked = parentOp
    ? parentOp.status === 'running'
    : await isParentResumable(get, registration.parentContext, toolMessageId);
  if (!parentParked) {
    log(
      'parent %s no longer parked (op status: %s), skipping resume',
      parentOperationId,
      parentOp?.status ?? 'missing',
    );
    // P2 (round-16): a cancelled parent (user stopped the run) still owns the
    // live deferred placeholder — `cancelOperation` recursively cancels the
    // child, whose interrupted terminal boundary fires this bridge. The early
    // return used to skip BOTH backfills, leaving the rendered tool card
    // permanently `status: 'running'` with the "Sub-agent is still running"
    // placeholder even though the child thread is settled. Backfill the
    // child's terminal result WITHOUT the `resumePending` marker: the parent
    // is settled out-of-band, so nobody will ever consume that marker (and a
    // stale one would read as a phantom resume target to reconstruction).
    // A MISSING op with an already-consumed placeholder (the post-reload
    // shape — the parent settled normally long ago) stays a no-op:
    // backfilling would overwrite the settled row with stale child output.
    if (parentOp || (await isParentResumable(get, registration.parentContext, toolMessageId))) {
      await backfillChildResult(get, registration.parentContext, toolMessageId, {
        context: registration.parentContext,
        resultContent,
        stats,
        succeeded,
      });
    }
    releasePending(registration);
    return;
  }

  // 1-2. Backfill the placeholder + persist the authoritative completion
  //      state (shared with the out-of-band path — see backfillChildResult).
  // P2 (round-7): plugin state MERGEs over the current state — the deferred
  // state's threadId carries the Open Thread coordinates; a blind replace
  // drops it the moment the child settles.
  // P1 (round-15): `resumePending: true` rides along — once the backfill
  // overwrites the `running` placeholder, this marker is the ONLY durable
  // park signal left. `optimisticUpdatePluginState` replaces the whole state
  // object, so the merged value below preserves every surviving key.
  await backfillChildResult(get, registration.parentContext, toolMessageId, {
    operationId: parentOperationId,
    resultContent,
    resumePending: true,
    stats,
    succeeded,
  });

  // 4. Parallel-call barrier: resume the parent only after the LAST pending
  //    child on this parent op settles. Earlier completions still backfill
  //    their own tool message above.
  if (!releasePending(registration)) {
    log('parent %s still waiting on other parked children, resume deferred', parentOperationId);
    return;
  }

  // 5. Retire the parked parent op (the human-approval park does this in
  //    onRunParked; the async-tool park keeps it running by design, so the
  //    bridge retires it at resume time) and re-enter the runtime from the
  //    tool message position under a new operation.
  // P1 (round-8): complete the parked parent op only AFTER re-entry
  // succeeds. Completing it first meant a resumeClientSubAgentParent throw
  // left the parent permanently unresumable: the outer catch restored the
  // claim + barrier slot, but every retry hit the `parentOp.status ===
  // 'running'` guard — actually `!parentParked` — and skipped the resume,
  // so no re-fire (automatic or manual) could recover. Keeping the op
  // running until re-entry succeeds makes every retry retryable.
  await resumeClientSubAgentParent(get, parentContext, toolMessageId);

  // P1 (round-15): re-entry succeeded — clear the durable resume-pending
  // marker now, BEFORE retiring the op. A re-park during the resumed turn
  // rewrites a fresh marker with the next backfill; a re-entry failure keeps
  // the old one, which is exactly the stranded-parent signature the
  // reconstruction path looks for.
  await clearResumePendingMarker(get, parentContext, toolMessageId, parentOperationId);

  get().completeOperation(parentOperationId);

  log('parent %s resumed with child result (%d chars)', parentOperationId, resultContent.length);
};

/**
 * P1 (round-15): clear the durable resume-pending marker after the parent
 * re-entry succeeded. Best-effort: a failure only leaves a stale marker on a
 * row whose bridge has already settled, and the persisted-coordinates cleanup
 * (the real re-fire guard) runs right after in the caller's success path.
 */
const clearResumePendingMarker = async (
  get: () => any,
  parentContext: ClientSubAgentBridgeRegistration['childContext'],
  toolMessageId: string,
  operationId?: string,
): Promise<void> => {
  try {
    const chatKey = messageMapKey(parentContext);
    const messages: Array<{ id?: string; pluginState?: Record<string, any> }> =
      get().dbMessagesMap[chatKey] || [];
    const toolRow = messages.find((m) => m.id === toolMessageId);
    if (!toolRow?.pluginState || toolRow.pluginState.resumePending !== true) return;
    const { resumePending: _cleared, ...rest } = toolRow.pluginState;
    await get().optimisticUpdatePluginState(
      toolMessageId,
      rest,
      operationId ? { operationId } : undefined,
    );
  } catch (error) {
    log('bridge: failed to clear resume-pending marker on %s: %O', toolMessageId, error);
  }
};

/**
 * Group-orchestration kind: deliver the member's final result into a fresh
 * `internal_execGroupOrchestration` re-entry seeded with the member's
 * `task_completed` result. The supervisor's next `decide()` then sees the
 * member's answer (its conversation was rebuilt with the backfilled tool
 * message) and drives the next round — the piece the old `result: undefined`
 * park-exit left permanently missing.
 */
const fireGroupOrchestrationBridge = async (
  get: () => any,
  registration: GroupOrchestrationBridgeRegistration,
  resultContent: string,
  succeeded: boolean,
  stats: Record<string, number | string | undefined>,
): Promise<void> => {
  const {
    memberAgentId,
    messageContext,
    orchestrationOperationId,
    supervisorAgentId,
    supervisorSnapshot,
    toolMessageId,
  } = registration;

  // The orchestration loop exited with a non-done state but its operation
  // stayed `running`; the re-entry mints a fresh operation, so retire the
  // parked one first (the human-approval "new op resumes the run" pattern).
  // After a reload the op is gone — the group tool row's deferred `running`
  // plugin state is the durable park signal (same rule as the sub-agent
  // kind). If either signal says the orchestration settled out-of-band, the
  // re-entry would double-drive the supervisor: backfill only.
  // The barrier slot is released too — the re-entry carries the whole
  // decision, so pending siblings of this parent op must not block it.
  const parkedOp = get().operations[orchestrationOperationId];
  const orchestrationParked = parkedOp
    ? parkedOp.status === 'running'
    : await isParentResumable(get, messageContext, toolMessageId);
  if (!orchestrationParked) {
    log(
      'orchestration op %s not running (status: %s), skipping re-entry',
      orchestrationOperationId,
      parkedOp?.status ?? 'missing',
    );
    // P2 (round-16): same contract as the sub-agent kind — a cancelled
    // orchestration still owns the live deferred placeholder, and skipping
    // BOTH backfills left the member's tool card permanently `running`.
    // Backfill WITHOUT the `resumePending` marker (same phantom-marker
    // reasoning — see the sub-agent kind); a missing op with an
    // already-consumed placeholder stays a no-op.
    if (parkedOp || (await isParentResumable(get, messageContext, toolMessageId))) {
      await backfillChildResult(get, messageContext, toolMessageId, {
        context: messageContext,
        resultContent,
        stats,
        succeeded,
      });
    }
    releasePending(registration);
    return;
  }

  // Backfill the supervisor's group tool message BEFORE re-entering — the
  // re-entered orchestration rebuilds the supervisor conversation from
  // persisted messages, so the supervisor LLM call must see the result.
  // Persist the authoritative completion state on the tool message (the
  // member's card) — same contract as the sub-agent kind, including the
  // flat spend stats the usage tray reads.
  // P2 (round-7): plugin state MERGEs over the current state — same contract
  // as the sub-agent kind (see above).
  // P1 (round-15): `resumePending: true` — the durable park signal after the
  // backfill overwrites the `running` placeholder (see the sub-agent kind).
  await backfillChildResult(get, messageContext, toolMessageId, {
    operationId: orchestrationOperationId,
    resultContent,
    resumePending: true,
    stats,
    succeeded,
  });

  // Release this member's barrier slot BEFORE re-entering: the re-entry
  // carries the whole decision, so a surviving slot would leak for the
  // lifetime of the tab (the registry claim is deleted by the caller, but
  // the module-level pendingByParentOp set stays reachable without this).
  releasePending(registration);

  // P1 (round-8): retire the parked orchestration op only AFTER the re-entry
  // succeeds — same recovery hole as the sub-agent kind: completing it first
  // let an internal_execGroupOrchestration throw leave the parked op
  // permanently unresumable, since every retry then failed the
  // `orchestrationParked` guard. Retiring after keeps the retry path alive.
  await get().internal_execGroupOrchestration({
    groupId: messageContext.groupId,
    initialResult: {
      payload: {
        agentId: memberAgentId,
        result: resultContent,
        // A failed/interrupted member must not drive the supervisor forward
        // as a success — the supervisor decides how to react to the failure.
        success: succeeded,
        // Restore the supervisor machine to its pre-park decision point: a
        // fresh machine would replay the consumed `supervisor_decided`
        // (deterministically re-calling the supervisor the original run had
        // already driven) and restart the round budget.
        ...(supervisorSnapshot ? { supervisorSnapshot } : {}),
      },
      type: 'task_completed',
    },
    supervisorAgentId,
    topicId: messageContext.topicId,
  });

  // P1 (round-15): re-entry succeeded — clear the durable resume-pending
  // marker (same contract as the sub-agent kind above).
  await clearResumePendingMarker(get, messageContext, toolMessageId, orchestrationOperationId);

  get().completeOperation(orchestrationOperationId);

  log(
    'orchestration %s re-entered after member %s settled (status=%s)',
    orchestrationOperationId,
    memberAgentId,
    succeeded ? 'done' : 'failed',
  );
};

/**
 * Completion-bridge resume entry: continue a parent run parked on a deferred
 * tool (a sub-agent that finished after parking the parent). Re-enters the
 * runtime from the tool message position with phase `tool_result` — the same
 * re-entry shape the human-approval resume uses, minus the approval payload.
 * The backfilled tool message is already persisted; the resumed turn consumes
 * it as the LLM's tool result.
 *
 * Lives here (not on the streaming executor) so the bridge is one
 * self-contained unit — the runtime wiring it needs (startOperation /
 * internal_createAgentState / executeClientAgent) all ride on the same store
 * `get`.
 */
const resumeClientSubAgentParent = async (
  get: () => any,
  parentContext: ClientSubAgentBridgeRegistration['childContext'],
  parentMessageId: string,
): Promise<void> => {
  const { agentId, topicId, threadId } = parentContext;

  const { operationId } = get().startOperation({
    context: {
      ...parentContext,
      messageId: parentMessageId,
    },
    label: 'Sub-agent completion resume',
    type: 'execAgentRuntime',
  } as any);

  get().associateMessageWithOperation(parentMessageId, operationId);

  // Select the resumed messages from the FULL parent context — the bucket key
  // must be rebuilt from the same fields the registration preserved (scope /
  // documentId / groupId / threadId). A reduced { agentId, topicId, threadId }
  // key collapsed page- and group-scoped parents into the main bucket, so the
  // resumed state lost the parent history and the backfilled tool result.
  const chatKey = messageMapKey(parentContext);
  const currentMessages = get().dbMessagesMap[chatKey] || [];

  const { context: initialContext, state } = get().internal_createAgentState({
    agentId,
    messages: currentMessages,
    operationId,
    parentMessageId,
    threadId: threadId ?? undefined,
    topicId,
  });

  // The resumed parent may park AGAIN (another deferred tool / callSubAgent in
  // its continuation). The wrapper operation's job ends once the runtime child
  // operation owns the continuation: executeClientAgent mints that child
  // (chained to the wrapper) and the next bridge registration references the
  // child, which stays `running` across the park. Completing the wrapper in
  // BOTH cases (terminal and re-park, success or throw) keeps operation
  // selectors from treating the conversation as busy forever.
  try {
    await get().executeClientAgent({
      context: parentContext,
      parentOperationId: operationId,
      initialContext: {
        ...initialContext,
        payload: { parentMessageId },
        phase: 'tool_result',
      },
      initialState: state,
      messages: currentMessages,
      parentMessageId,
      parentMessageType: 'tool',
      // No `skipCreateFirstMessage`: seeding the tool row as the assistant
      // placeholder made the resumed LLM answer stream INTO the tool row,
      // overwriting the child result just backfilled. Let the runtime create
      // a fresh assistant row (the human-approval resume path does the same).
    });
  } finally {
    get().completeOperation(operationId);
  }
};

/**
 * Arm every bridge registration parked on THIS run: the run just entered
 * `waiting_for_async_tool`, which is the point where the deferred placeholder
 * is authoritative and the parent will not settle on its own anymore. Called
 * from the parked branch of the client run boundary — BEFORE this point a
 * registration must stay unarmed because the parent may still be executing
 * other tool lanes (the deferred pause only assembles after ALL lanes of the
 * step settle), and resuming early would let the parent's own deferred path
 * overwrite the resumed turn with the "still running" placeholder.
 *
 * Scanning the run's own message bucket for tool rows whose plugin state
 * carries a child threadId (the deferred callSubAgent shape) is what makes
 * the ordering explicit: a parallel lane's callSubAgent that has NOT returned
 * its deferred result yet has no `running` plugin state row here, so its
 * registration (if it registers later) waits for ITS park — the barrier only
 * counts armed siblings.
 *
 * P1 fix (round-7): arming also replays completions HELD at the child's
 * terminal boundary because a parallel lane still kept the parent from
 * parking — the child has no second terminal boundary, so without the replay
 * the parent would park forever.
 */
export const armClientSubAgentBridgesForContext = (
  get: () => any,
  context: ConversationContext,
): void => {
  const chatKey = messageMapKey(context);
  const messages: Array<{ pluginState?: { status?: string; threadId?: string }; role?: string }> =
    get().dbMessagesMap[chatKey] || [];

  for (const message of messages) {
    if (message.role !== 'tool') continue;
    const state = message.pluginState;
    if (state?.status !== 'running' || !state.threadId) continue;

    const registration = registry.get(state.threadId);
    if (!registration || registration.armed) continue;

    registry.set(state.threadId, { ...registration, armed: true });
    log('bridge armed: key=%s kind=%s', state.threadId, registration.kind);

    // Replay the completion that arrived before the park (P1 round-7). The
    // fire's own CAS deletes the claim on success; a failure restores both
    // claim and slot for the retry.
    const held = heldCompletions.get(state.threadId);
    if (!held) continue;
    heldCompletions.delete(state.threadId);
    log('bridge replaying held completion at park: key=%s', state.threadId);
    void fireClientSubAgentBridge(get, registration.childContext, held);
  }
};

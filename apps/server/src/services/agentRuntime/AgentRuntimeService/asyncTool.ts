import type { AgentState } from '@lobechat/agent-runtime';
import { asyncToolResumeCounter } from '@lobechat/observability-otel/modules/agent-runtime';
import { type ChatToolPayload } from '@lobechat/types';
import debug from 'debug';

import { AgentOperationModel } from '@/database/models/agentOperation';

import { type GroupActionOnComplete } from '../types';
import { ASYNC_TOOL_VERIFY_MAX_ATTEMPTS } from './constants';
import type { AgentRuntimeServiceContext } from './types';
import { asyncToolVerifyDelayMs } from './utils';

const log = debug('lobe-server:agent-runtime-service');

/** What this module reads off the service. */
export type AsyncToolDeps = Pick<
  AgentRuntimeServiceContext,
  | 'allPendingToolsFulfilled'
  | 'baseURL'
  | 'coordinator'
  | 'maybeScheduleAsyncToolVerify'
  | 'messageModel'
  | 'queueService'
  | 'resolveAsyncToolOnComplete'
  | 'serverDB'
  | 'userId'
>;

/**
 * Completion-bridge entry point for async sub-agent tools.
 *
 * Called once per sub-op completion (the bridge already backfilled that
 * sub-op's tool message). Implements the K=N barrier + single-fire resume:
 *
 *   1. The parent must still be parked (`waiting_for_async_tool`).
 *   2. Every tool in this turn's `pendingToolsCalling` must be fulfilled —
 *      the true gate, since the LLM can only continue once every tool_result
 *      message row is present (covers mixed sub-agent + client-tool batches).
 *   3. Atomically claim the resume via a status CAS; only the winner proceeds.
 *   4. Schedule the parent's next step (`resumeAsyncTool`), which re-enters
 *      the LLM with the refreshed tool results.
 *
 * Returns true only for the CAS winner that scheduled the resume.
 *
 * `options.scheduleVerifyOnHold` arms a one-shot delayed re-check
 * (`verifyAsyncToolBarrier`) when the parent is found not yet resumable.
 * Sub-agent completions set it to cover the child finishing before the
 * parent's parked state is persisted, and transient failures around the
 * last completion (a sibling dying between backfill and resume, a DB
 * hiccup during the barrier read). Pure concurrency needs no cover: each
 * completion checks the barrier only after committing its own backfill, so
 * the last committer always sees every earlier one. The re-check itself
 * never re-arms, so retries stay bounded.
 */
export async function tryResumeParentFromAsyncTool(
  deps: AsyncToolDeps,
  params: { parentOperationId: string },
  options?: {
    /**
     * Message id of a tool placeholder the caller just backfilled to a
     * terminal state. Trusted by the barrier as fulfilled without re-reading
     * `message_plugins` — closes the read-your-writes gap where the barrier
     * query hits a read replica that hasn't seen the just-committed write.
     */
    knownFulfilledMessageId?: string;
    /**
     * Group orchestration disposition (skipCallSupervisor / delegate → finish).
     * When omitted, resolved from the parked tool message's pluginState.
     */
    onComplete?: GroupActionOnComplete;
    scheduleVerifyOnHold?: boolean;
    /** 1-based watchdog attempt to arm when the parent isn't resumable yet. */
    verifyAttempt?: number;
  },
): Promise<boolean> {
  const { parentOperationId } = params;

  const state = await deps.coordinator.loadAgentState(parentOperationId);
  if (!state) {
    // State expired (Redis TTL) or never persisted. A missing state at
    // completion time is a classic way a parent silently strands — but it is
    // often transient: a read replica that hasn't seen the park yet, or the
    // child outrunning the parent's park before its snapshot lands. Arm the
    // bounded verify so a later re-check can resume once the state is visible,
    // instead of giving up on the first miss. A genuinely-gone parent just
    // exhausts the attempt cap (verify_exhausted) rather than stranding here.
    log('[%s] async-tool resume: parent state missing/expired, arming verify', parentOperationId);
    asyncToolResumeCounter.add(1, { outcome: 'no_state' });
    await deps.maybeScheduleAsyncToolVerify(parentOperationId, null, options);
    return false;
  }

  if (state.status !== 'waiting_for_async_tool') {
    // Not parked (yet). Either the op already resumed/finished — nothing to
    // do — or the child outran the parent's parking step; the delayed verify
    // re-checks once the park has had time to land.
    await deps.maybeScheduleAsyncToolVerify(parentOperationId, state, options);
    return false;
  }

  const pending = (state.pendingToolsCalling ?? []) as ChatToolPayload[];
  if (pending.length === 0) {
    // Parked but no pending tools recorded — usually the parked snapshot's
    // `pendingToolsCalling` hasn't finished persisting yet. Warn, report, and
    // arm a fallback re-check rather than returning silently (the old bug).
    log(
      '[%s] async-tool resume: parked op has no pending tools, arming fallback',
      parentOperationId,
    );
    asyncToolResumeCounter.add(1, { outcome: 'no_pending' });
    await deps.maybeScheduleAsyncToolVerify(parentOperationId, state, options);
    return false;
  }

  // Barrier: every pending tool must have a fulfilled tool_result message.
  const allFulfilled = await deps.allPendingToolsFulfilled(
    pending,
    options?.knownFulfilledMessageId,
  );
  if (!allFulfilled) {
    log('[%s] async-tool barrier not yet satisfied, holding', parentOperationId);
    asyncToolResumeCounter.add(1, { outcome: 'barrier_held' });
    await deps.maybeScheduleAsyncToolVerify(parentOperationId, state, options);
    return false;
  }

  // Group orchestration's skipCallSupervisor / delegate ends the supervisor
  // op without another LLM turn: the same CAS gate flips the parked op, but
  // the scheduled step finishes it (`finishAfterAsyncTool`) instead of
  // re-entering the LLM (`resumeAsyncTool`). Self-describing so the generic
  // verify watchdog resolves it correctly: the option (if any) wins, else the
  // hint persisted on the parked tool message's pluginState, else resume.
  const onComplete: GroupActionOnComplete =
    options?.onComplete ?? (await deps.resolveAsyncToolOnComplete(pending));

  // Single-fire guard: only one concurrent completion flips the op.
  const won = await new AgentOperationModel(deps.serverDB, deps.userId).tryResumeFromAsyncTool(
    parentOperationId,
  );
  if (!won) {
    log('[%s] lost async-tool resume CAS, no-op', parentOperationId);
    asyncToolResumeCounter.add(1, { outcome: 'lost_cas' });
    return false;
  }

  asyncToolResumeCounter.add(1, { outcome: 'resumed' });

  log(
    '[%s] won async-tool resume CAS, scheduling step %d (onComplete: %s)',
    parentOperationId,
    state.stepCount,
    onComplete,
  );

  if (deps.queueService) {
    await deps.queueService.scheduleMessage({
      context: undefined,
      delay: 100,
      endpoint: `${deps.baseURL}/run`,
      operationId: parentOperationId,
      payload: onComplete === 'finish' ? { finishAfterAsyncTool: true } : { resumeAsyncTool: true },
      priority: 'high',
      stepIndex: state.stepCount,
    });
  } else {
    log('[%s] queue service disabled, skipping async-tool resume schedule', parentOperationId);
  }

  return true;
}

/**
 * Arm the next bounded `verifyAsyncToolBarrier` re-check for a parent op whose
 * resume attempt found it not yet resumable. Skipped for terminal states
 * (nothing left to resume) and when the caller didn't opt in.
 *
 * Unlike the original single shot, the watchdog re-arms after each unsatisfied
 * check: the verify handler re-enters here with `verifyAttempt + 1`, backing
 * off exponentially up to {@link ASYNC_TOOL_VERIFY_MAX_ATTEMPTS}. A transient
 * miss (read-replica lag, a sibling dying between backfill and resume) is thus
 * retried instead of permanently stranding the parent. Once attempts are
 * exhausted the chain stops and the `verify_exhausted` metric fires so the
 * orphan is observable. For details see: async sub-agent suspend/resume stability hardening — bounded watchdog retry with exponential backoff.
 */
export async function maybeScheduleAsyncToolVerify(
  deps: AsyncToolDeps,
  parentOperationId: string,
  state: AgentState | null,
  options?: { scheduleVerifyOnHold?: boolean; verifyAttempt?: number },
): Promise<void> {
  if (!options?.scheduleVerifyOnHold || !deps.queueService) return;

  // `state` is null when the parked snapshot is missing/expired at completion
  // time (no_state). We can't read a status to skip a terminal op, but the
  // bounded attempt cap below keeps a genuinely-gone parent from re-arming
  // forever, so it's safe to retry instead of stranding on a transient miss.
  const status = state?.status as string | undefined;
  if (status === 'done' || status === 'error' || status === 'interrupted') return;

  const attempt = options.verifyAttempt ?? 1;
  if (attempt > ASYNC_TOOL_VERIFY_MAX_ATTEMPTS) {
    // Bounded retries spent and the parent is still not resumable — give up
    // re-arming and report so the stuck wait can be detected, not silently
    // accumulated.
    log(
      '[%s] async-tool barrier verify exhausted after %d attempts, giving up (status: %s)',
      parentOperationId,
      ASYNC_TOOL_VERIFY_MAX_ATTEMPTS,
      status ?? 'missing',
    );
    asyncToolResumeCounter.add(1, { outcome: 'verify_exhausted' });
    return;
  }

  const delay = asyncToolVerifyDelayMs(attempt);
  log(
    '[%s] scheduling async-tool barrier verify attempt %d/%d in %dms (status: %s)',
    parentOperationId,
    attempt,
    ASYNC_TOOL_VERIFY_MAX_ATTEMPTS,
    delay,
    status ?? 'missing',
  );

  try {
    await deps.queueService.scheduleMessage({
      context: undefined,
      delay,
      endpoint: `${deps.baseURL}/run`,
      operationId: parentOperationId,
      payload: { asyncToolVerifyAttempt: attempt, verifyAsyncToolBarrier: true },
      priority: 'high',
      stepIndex: state?.stepCount ?? 0,
    });
  } catch (error) {
    log(
      '[%s] failed to schedule async-tool barrier verify (non-fatal): %O',
      parentOperationId,
      error,
    );
  }
}

/**
 * Whether every pending tool call has a fulfilled tool_result message — i.e.
 * a tool message exists for its `tool_call_id` with non-empty content or a
 * terminal pluginState. Looks up by `tool_call_id` (plugin id === message id).
 *
 * `knownFulfilledMessageId` short-circuits the per-tool content/state read for
 * a placeholder the caller just backfilled in the same request: its terminal
 * write is a local fact, so re-reading it (possibly from a lagging read
 * replica) would only risk a false negative that strands the parent. The
 * plugin row itself predates the park, so the `tool_call_id → plugin.id`
 * lookup still resolves; only the freshly written content/state is trusted.
 */
export async function allPendingToolsFulfilled(
  deps: AsyncToolDeps,
  pending: ChatToolPayload[],
  knownFulfilledMessageId?: string,
): Promise<boolean> {
  for (const tc of pending) {
    const plugin = await deps.serverDB.query.messagePlugins.findFirst({
      where: (mp, { eq }) => eq(mp.toolCallId, tc.id),
    });
    if (!plugin) return false;

    // Trust the caller's own just-committed backfill (read-your-writes).
    if (knownFulfilledMessageId && plugin.id === knownFulfilledMessageId) continue;

    const message = await deps.messageModel.findById(plugin.id);
    const pluginState = plugin.state as { status?: string } | null;
    const fulfilled =
      (!!message?.content && message.content.length > 0) ||
      pluginState?.status === 'completed' ||
      pluginState?.status === 'error';
    if (!fulfilled) return false;
  }
  return true;
}

/**
 * Resolve the resume disposition for a parked op from the disposition hint
 * persisted on its first pending tool message's pluginState. Group
 * orchestration stamps `onComplete: 'finish'` there for skipCallSupervisor /
 * delegate; everything else (sub-agents, client tools) resolves to `resume`.
 * Self-describing so the generic verify watchdog finishes the right ops.
 */
export async function resolveAsyncToolOnComplete(
  deps: AsyncToolDeps,
  pending: ChatToolPayload[],
): Promise<GroupActionOnComplete> {
  // A batched turn can park multiple deferred/client tools. If ANY of them is
  // a group action requesting finish (skipCallSupervisor / delegate), the
  // orchestration must finish — reading only pending[0] would miss a group
  // finish call that isn't the first pending tool and wrongly resume.
  for (const tool of pending) {
    const plugin = await deps.serverDB.query.messagePlugins.findFirst({
      where: (mp, { eq }) => eq(mp.toolCallId, tool.id),
    });
    const pluginState = plugin?.state as { onComplete?: string } | null;
    if (pluginState?.onComplete === 'finish') return 'finish';
  }
  return 'resume';
}

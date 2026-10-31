/**
 * Terminal persistence: the `agent_operations` completion row, the topic
 * running mark, and the topic usage rollup.
 */
import { getLlmCallCount, isParkedStatus } from '@lobechat/agent-runtime';
import { type AgentOperationStatus, isAgentOperationInFlight } from '@lobechat/types';
import debug from 'debug';

import type { ChildUsageRollup } from '@/database/models/agentOperation';
import { TopicModel } from '@/database/models/topic';
import { recomputeTopicUsage } from '@/database/models/topicUsage';
import { buildFinalSnapshotKey } from '@/server/modules/AgentTracing';

import type { CompletionLifecycleDeps } from './types';

const log = debug('lobe-server:completion-lifecycle');

/**
 * The topic status a finished run leaves behind, mirroring what the client
 * writes for the same outcome (`executeGatewayAgent`'s `onSessionComplete`) and
 * what `agentNotify` does for the remote path: only a clean finish is something
 * the user may not have watched (`unread`); every other ending is an
 * interruption they already saw (`active`).
 *
 * Agrees with the one existing server-side settle, too:
 * `ServerOperationStore.clearRunningMark` hardcodes `unread`, and it only ever
 * runs from the `finish` executor — the success path, where this helper returns
 * `unread` as well.
 */
const topicStatusForTerminalRun = (status: string): 'active' | 'unread' =>
  status === 'done' ? 'unread' : 'active';

/**
 * Map a completion reason to the terminal `agent_operations.status` value.
 * `waiting_for_human` / `waiting_for_async_tool` keep their own status so
 * analytics can distinguish paused ops from terminal ones.
 */
export function statusForReason(
  reason: string,
):
  | 'done'
  | 'error'
  | 'interrupted'
  | 'waiting_for_human'
  | 'waiting_for_async_tool'
  | 'waiting_for_client' {
  switch (reason) {
    case 'error': {
      return 'error';
    }
    case 'interrupted': {
      return 'interrupted';
    }
    case 'waiting_for_human': {
      return 'waiting_for_human';
    }
    case 'waiting_for_async_tool': {
      return 'waiting_for_async_tool';
    }
    case 'waiting_for_client': {
      return 'waiting_for_client';
    }
    default: {
      return 'done';
    }
  }
}

/**
 * Persist terminal state to `agent_operations`. Fire-and-forget: a DB
 * outage must never block hook dispatch or the executor's terminal
 * cleanup path.
 */
export async function persistCompletion(
  deps: CompletionLifecycleDeps,
  operationId: string,
  state: any,
  reason: string,
  settledAsAbandoned?: boolean,
): Promise<boolean> {
  const completionReason: any = settledAsAbandoned
    ? 'lease_expired'
    : reason === 'max_steps' ||
        reason === 'cost_limit' ||
        reason === 'tool_call_repeat_limit' ||
        reason === 'waiting_for_human' ||
        reason === 'waiting_for_async_tool' ||
        reason === 'waiting_for_client'
      ? reason
      : statusForReason(reason);

  const runOrigin = state?.origin ?? {};
  const agentId = runOrigin.agentId;
  const topicId = runOrigin.topicId;
  const traceS3Key =
    agentId && topicId ? buildFinalSnapshotKey(agentId, topicId, operationId) : null;

  const processingTimeMs = state?.createdAt
    ? Date.now() - new Date(state.createdAt).getTime()
    : null;

  const runtimeStatus = statusForReason(reason);
  const status = settledAsAbandoned ? ('abandoned' as const) : runtimeStatus;
  // Parked statuses are pauses, not true terminal states — leave completedAt
  // null so analytics doesn't read a paused op as completed. The next
  // dispatchHooks call (when the op resumes and truly ends) overwrites both.
  const completedAt = isParkedStatus(runtimeStatus) ? undefined : new Date();

  // Fold every child operation's spend (callSubAgent children, isolated group
  // members) into the parent's totals, so an op's row accounts for the whole
  // tree it forked rather than only the tokens its own turns burned.
  //
  // Re-derived from the child rows on every write instead of accumulated onto
  // this one: `recordCompletion` is a wholesale SET, and this method runs again
  // each time the op parks and resumes — an additive rollup would multiply. The
  // SUM is exact however often it re-runs.
  //
  // Skipped for sub-agents and group members themselves: nested sub-agents are
  // rejected up front, so a child never has children of its own and the query
  // would always return zero.
  const rollup =
    runOrigin.lineage?.isSubAgent === true ? undefined : await sumChildUsage(deps, operationId);

  const add = (own: number | null | undefined, child: number): number | null => {
    if (!child) return own ?? null;
    return (own ?? 0) + child;
  };

  let completionDurable = false;
  let conflictingTerminalOwner = false;
  // The status the durable row actually carries. Usually this callback's own,
  // but NOT when a terminal owner got there first with a different one — see
  // the fallback below.
  let durableStatus: AgentOperationStatus = status;
  try {
    const accepted = await deps.agentOperationModel.recordCompletion(operationId, {
      completedAt,
      completionReason,
      cost: state?.cost ?? null,
      error: state?.error ?? null,
      interruption: state?.interruption ?? null,
      llmCalls: add(getLlmCallCount(state), rollup?.llmCalls ?? 0),
      // Backfill the executed model/provider when the terminal state carries
      // them. The in-process runtime sets neither on `state` (the op already
      // holds them from recordStart) so these stay undefined and recordCompletion
      // skips them — a no-op. A heterogeneous run, which only learns its real
      // model from the CLI stream, feeds them in via the synthetic state built in
      // heteroFinish; the verify gate keys off op.model/provider, so dropping this
      // backfill would leave op.model null and silently skip verify.
      model: state?.model,
      processingTimeMs,
      provider: state?.provider,
      status,
      stepCount: state?.stepCount ?? null,
      toolCalls: add(state?.usage?.tools?.totalCalls, rollup?.toolCalls ?? 0),
      totalCost: add(state?.cost?.total, rollup?.totalCost ?? 0),
      totalInputTokens: add(state?.usage?.llm?.tokens?.input, rollup?.totalInputTokens ?? 0),
      totalOutputTokens: add(state?.usage?.llm?.tokens?.output, rollup?.totalOutputTokens ?? 0),
      totalTokens: add(state?.usage?.llm?.tokens?.total, rollup?.totalTokens ?? 0),
      traceS3Key,
      // The `usage` / `cost` blobs stay the op's OWN accumulator, un-rolled-up:
      // they are the runtime's counter, and the executor reads them back as state
      // (the cost-limit gate compares `state.cost.total` against the budget). Only
      // the scalar columns — the reporting surface — carry the whole tree.
      usage: state?.usage ?? null,
    });
    if (accepted) {
      completionDurable = true;
    } else {
      const operation = await deps.agentOperationModel.findById(operationId);
      // Preserve the historical best-effort behavior when no durable start
      // row exists, but never let a conflicting terminal owner be replaced.
      conflictingTerminalOwner = !!operation;
      // Someone else wrote a terminal row: the run is over even though this
      // call is not the one that recorded it.
      completionDurable = conflictingTerminalOwner;
      // `recordCompletion` only refuses a row that is ALREADY terminal with a
      // different status than this callback carries (its `where` matches every
      // in-flight status, plus an equal one). So the row it refused is the
      // authoritative outcome, and the topic must be settled for what landed —
      // not for what this late callback is carrying. Two racing terminal
      // callbacks (`done` vs `error`/`interrupted`) would otherwise write
      // whichever one arrived second, `unread` and `active` included.
      if (operation) durableStatus = operation.status;
    }
  } catch (error) {
    log('[%s] Failed to persist operation completion (non-fatal): %O', operationId, error);
  }

  // The run is over durably — converge the topic's running mark, or it outlives
  // the run (see `settleTopicRunningMark`). Deliberately not attempted when the
  // completion above did not land: a DB error or a missing start row leaves the
  // operation's own end unproven, and a mark cleared on an unproven ending
  // reads as settled while `agent_operations` still says `running`.
  if (completionDurable) {
    await settleTopicRunningMark(deps, { operationId, status: durableStatus, topicId });
  }

  if (conflictingTerminalOwner) return false;

  // The topic rollup's tool / human-interaction stats derive from the
  // operation rows written above (`recomputeTopicUsage` reads their usage/cost
  // blobs), but its usual trigger is the assistant message's usage write,
  // which can land BEFORE this terminal persist. Refresh here so this op's
  // tool spend shows up without waiting for the next message mutation.
  // Idempotent (pure derived projection) and non-fatal.
  if (topicId) {
    try {
      await deps.serverDB.transaction((trx) =>
        recomputeTopicUsage(trx, deps.userId, topicId, deps.workspaceId),
      );
    } catch (error) {
      log('[%s] Failed to recompute topic usage rollup (non-fatal): %O', operationId, error);
    }
  }

  return true;
}

/**
 * Drop the topic's `runningOperation` mark when a run reaches its terminal row.
 *
 * The ONLY server-side settle used to be `ServerOperationStore.clearRunningMark`,
 * and it runs from a single place: the `finish` executor. Every ending that
 * never emits a `finish` instruction therefore wrote a terminal
 * `agent_operations` row and left the topic exactly as the run's start had left
 * it — `status = 'running'` with `metadata.runningOperation` naming an operation
 * that had already finished:
 *
 * - a Stop is persisted at the step boundary (`AgentRuntimeService.executeStep`
 *   sets the state to `interrupted` once the in-flight step returns), and the
 *   following delivery usually finds the operation already terminal;
 * - `interruptOperation` settles a client-parked run itself, and
 *   `buildShareAbortResult` settles a revoked share visitor run;
 * - a loop stopped by `max_steps` / `cost_limit` ends without the agent asking
 *   to finish.
 *
 * Nothing then revisited the row: the client's own settle is a single attempt
 * that a transient server refusal discards, and the client watchdog only runs
 * with that user's sidebar open. Observed 2026-10-13 on a self-hosted
 * deployment as a topic shown "running" for 45 minutes whose operation row had
 * been `interrupted` since 03:33:58Z with `topics.updated_at` frozen at the
 * run's start — `settleRunningOperation` always bumps `updated_at`, so that
 * timestamp is proof no settle ever reached the row. 16 rows of the same shape,
 * the oldest two months old.
 *
 * Persisting the terminal row is the moment the run is over, so converging
 * here covers every ending above (and any future one) instead of adding a call
 * to each caller. Compare-and-clear, exactly as the executor's adapter does:
 * only the operation the mark names — or one of its children — may drop it, so
 * a newer run that claimed the topic meanwhile is left alone and answers
 * `conflict`. Best-effort: a topic that cannot be reached must not fail the
 * completion it already persisted.
 */
export async function settleTopicRunningMark(
  deps: CompletionLifecycleDeps,
  params: {
    operationId: string;
    status: AgentOperationStatus;
    topicId?: string;
  },
): Promise<void> {
  const { operationId, status, topicId } = params;

  // No topic to settle (a sub-agent run, a bot thread, a verify pass).
  if (!topicId) return;
  // Only an ending may drop the mark. Not merely the parked three: the fallback
  // above settles for the status read back from the row rather than one this
  // callback authored, and `idle` / `running` are no more of an ending than a
  // pause is. `isAgentOperationInFlight` is the shared authority for both.
  if (isAgentOperationInFlight(status)) return;
  // A lease-expired abandon settles the topic on its own path with its own
  // status (`AbandonOperationService`); leave that one to it.
  if (status === 'abandoned') return;

  try {
    const topicModel = new TopicModel(deps.serverDB, deps.userId, deps.workspaceId, undefined, {
      includeShareVisitor: deps.includeShareVisitor,
    });

    const settled = await topicModel.settleRunningOperation(
      topicId,
      operationId,
      topicStatusForTerminalRun(status),
    );

    // `missing` (another writer already cleared it) and `conflict` (a newer run
    // owns the mark) are both correct no-ops, not failures.
    if (settled.status !== 'settled') {
      log('[%s] Topic running mark left alone: %s', operationId, settled.status);
    }
  } catch (error) {
    log('[%s] Failed to settle the topic running mark (non-fatal): %O', operationId, error);
  }
}

/** Best-effort child-usage rollup — a DB hiccup must not fail the completion write. */
export async function sumChildUsage(
  deps: CompletionLifecycleDeps,
  operationId: string,
): Promise<ChildUsageRollup | undefined> {
  try {
    return await deps.agentOperationModel.sumChildUsage(operationId);
  } catch (error) {
    log('[%s] Failed to sum child operation usage (non-fatal): %O', operationId, error);
    return undefined;
  }
}

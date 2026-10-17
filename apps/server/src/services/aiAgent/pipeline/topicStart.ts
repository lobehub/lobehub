import type { ExecAgentResult } from '@lobechat/types';
import { nanoid } from '@lobechat/utils';
import debug from 'debug';

import { deriveAgentInterventionContinuationOperationId } from '@/business/server/agent-run/agentInterventionIdentity';
import type { AgentOperationModel } from '@/database/models/agentOperation';
import type { TopicModel } from '@/database/models/topic';
import type { AgentRuntimeService } from '@/server/services/agentRuntime';
// Imported from the module itself: tests mock the `agentRuntime` barrel.
import {
  isComposerSupersedableTrigger,
  type SupersedeKind,
  type SupersedeRecord,
} from '@/server/services/agentRuntime/foregroundOperation';

import { acquireTopicStartReservation, TopicStartReservationError } from '../topicStartReservation';
import type { InternalExecAgentParams } from '../types';

const log = debug('lobe-server:ai-agent-service');

export interface TopicStartDeps {
  agentOperationModel: AgentOperationModel;
  agentRuntimeService: AgentRuntimeService;
  interruptTask: (params: {
    operationId?: string;
    topicId?: string;
  }) => Promise<{ deviceCancellationConfirmed?: boolean; success: boolean }>;
  topicModel: TopicModel;
  userId: string;
  workspaceId?: string;
}

export interface SupersededOperation {
  holderId: string;
  kind: SupersedeKind;
}

/**
 * The run this start replaces. A composer send names it from client state, so
 * it is honored only when it is one of this user's runs on the same topic;
 * server-derived continuations are trusted as given.
 */
export const resolveReplacedOperationId = async (
  deps: TopicStartDeps,
  params: InternalExecAgentParams,
  topicId: string,
): Promise<string | undefined> => {
  const { replacesOperationId } = params;
  if (!replacesOperationId || !params.interactiveStart) return replacesOperationId;

  const replaced = await deps.agentOperationModel.findById(replacesOperationId);
  return replaced?.topicId === topicId ? replacesOperationId : undefined;
};

/**
 * Retire the foreground run that still owns the topic's `runningOperation`
 * before an interactive send starts the next one.
 *
 * The client is expected to stop a live run before sending (Stop / Send now)
 * or to queue the send until the run yields. When it misses one, nothing else
 * stops that run: `startOperation` overwrites the marker, and both runs keep
 * reading the same topic, interleave writes, and invalidate each other's
 * prompt cache, multiplying the conversation's cost for as long as the old
 * run lives.
 *
 * Runs inside the topic-start reservation so two fast sends cannot both read
 * the same stale holder. Only a `running` foreground run is retired; these
 * keep the existing behavior:
 * - a parked run (`waiting_for_human` etc.) — the send may be its answer;
 * - a background producer's run (task, cron, bot, …), see
 *   `isComposerSupersedableTrigger` in `agentRuntime/foregroundOperation`.
 *   An Agent Signal run on the main spine (task-result wakeup) is retired
 *   like a foreground run: the client never tracks it, so it cannot queue;
 * - a device-hosted Claude Code / Codex run: cancelling it waits up to 10s
 *   for the device, far past the reservation's ~3s retry budget, so a
 *   concurrent send would fail. Those settle through `replacesOperationId`
 *   before reserving.
 *
 * @returns the retired run and whether it had already been asked to stop, so
 * the caller can record the overlap on the new run.
 */
export const supersedeRunningForegroundOperation = async (
  deps: TopicStartDeps,
  topicId: string,
  alreadyHandledOperationIds: (string | undefined)[],
): Promise<SupersededOperation | undefined> => {
  const topic = await deps.topicModel.findById(topicId);
  const marker = topic?.metadata?.runningOperation;
  const holderId = marker?.operationId;
  if (!holderId || marker.heteroType || alreadyHandledOperationIds.includes(holderId)) return;

  const holder = await deps.agentOperationModel.findById(holderId);
  if (holder?.status !== 'running') return;
  if (!isComposerSupersedableTrigger(holder.trigger)) return;

  // Read before interrupting: afterwards the sentinel is always set. The
  // read is diagnostic only, so a failure must not fail the send.
  let kind: SupersedeKind;
  try {
    kind = (await deps.agentRuntimeService.isOperationInterrupted(holderId))
      ? 'already_stopping'
      : 'client_missed';
  } catch (error) {
    console.error('[execAgent] failed to read interrupt state of %s:', holderId, error);
    kind = 'unknown';
  }

  log(
    'execAgent: superseding running foreground operation %s on topic %s (%s)',
    holderId,
    topicId,
    kind,
  );
  const interrupted = await deps.interruptTask({ operationId: holderId, topicId });
  // Unconfirmed only when the run has no runtime state left but its row has
  // not settled yet: nothing executes its next step, so the send proceeds
  // rather than failing on a run that cannot spend any more.
  if (!interrupted.success) {
    console.warn('[execAgent] supersede of %s was not confirmed', holderId, { topicId });
  }
  return { holderId, kind };
};

/**
 * Persist the supersede on the new run's `metadata.supersede`, with the
 * client's view of its runs at send time. A `client_missed` supersede means
 * the client let a live run keep going — the case to investigate — so it is
 * also warned. Diagnostic only: a failure here never fails the send.
 */
export const recordSupersede = async (
  deps: TopicStartDeps,
  topicId: string,
  operationId: string,
  superseded: SupersededOperation,
  params: InternalExecAgentParams,
): Promise<void> => {
  const record: SupersedeRecord = {
    client: params.clientRunSnapshot,
    kind: superseded.kind,
    supersededAt: new Date().toISOString(),
    supersededOperationId: superseded.holderId,
  };

  if (superseded.kind === 'client_missed') {
    console.warn('[execAgent] client missed a running foreground operation', {
      client: params.clientRunSnapshot,
      operationId,
      supersededOperationId: superseded.holderId,
      topicId,
    });
  }

  try {
    await deps.agentOperationModel.mergeMetadata(operationId, { supersede: record });
  } catch (error) {
    console.error('[execAgent] failed to record supersede on %s:', operationId, error);
  }
};

/**
 * Claim the topic for a new run, then start it through `run`.
 *
 * Thread runs and topic-less runs start directly. A topic run first settles
 * the run it replaces, takes the topic-start reservation, retires a live
 * foreground run on an interactive send, and releases the reservation once
 * `run` returns.
 */
export const runWithTopicStart = async (
  deps: TopicStartDeps,
  params: InternalExecAgentParams,
  run: (params: InternalExecAgentParams) => Promise<ExecAgentResult>,
): Promise<ExecAgentResult> => {
  const topicId = params.appContext?.topicId;
  const interventionReservationId = params.approvalResolutionRequestId
    ? deriveAgentInterventionContinuationOperationId({
        resolutionRequestId: params.approvalResolutionRequestId,
        userId: deps.userId,
        workspaceId: deps.workspaceId,
      })
    : undefined;
  if (
    interventionReservationId &&
    params.topicStartReservationId &&
    params.topicStartReservationId !== interventionReservationId
  ) {
    throw new Error('Intervention continuation reservation identity conflict');
  }
  const reservationId =
    interventionReservationId ?? params.topicStartReservationId ?? `agent-start-${nanoid()}`;
  const isInterventionThreadStart = Boolean(
    topicId &&
    params.appContext?.threadId &&
    interventionReservationId &&
    params.approvalResolutionRequestId,
  );
  // Thread runs are isolated under an explicit parent message and do not
  // advance the topic's main spine. They may start while their parent
  // operation owns `runningOperation` (for example callAgent/callSubAgent),
  // so making them wait for the topic-start claim deadlocks the child start.
  if (!topicId || (params.appContext?.threadId && !isInterventionThreadStart)) {
    return run(params);
  }

  const replacesOperationId = isInterventionThreadStart
    ? undefined
    : await resolveReplacedOperationId(deps, params, topicId);

  // A replacement is allowed to take over the topic marker, but the device
  // process that owned the old marker may still hold a native Codex/CC writer.
  // Settle that physical run before reserving and dispatching the replacement;
  // otherwise two `lh hetero exec` wrappers can resume the same thread.
  if (replacesOperationId) {
    const interruption = await deps.interruptTask({
      operationId: replacesOperationId,
      topicId,
    });
    if (interruption.deviceCancellationConfirmed === false) {
      throw new Error('Replaced heterogeneous agent process did not confirm termination');
    }
  }
  const reserved = await acquireTopicStartReservation({
    allowSameReservationReentry: !params.approvalResolutionRequestId,
    replacesOperationId,
    allowRunningOperationId: params.topicStartOwnerOperationId,
    // A thread continuation shares the topic row but never owns/replaces its
    // main runningOperation anchor. It uses only the short initializer fence.
    ignoreRunningOperation: isInterventionThreadStart || params.interactiveStart,
    reservationId,
    topicId,
    topicModel: deps.topicModel,
  });

  if (!reserved) {
    throw new TopicStartReservationError(`Topic not found: ${topicId}`);
  }

  try {
    const superseded =
      params.interactiveStart && !isInterventionThreadStart
        ? await supersedeRunningForegroundOperation(deps, topicId, [
            replacesOperationId,
            params.topicStartOwnerOperationId,
          ])
        : undefined;
    const result = await run(params);
    if (superseded) {
      await recordSupersede(deps, topicId, result.operationId, superseded, params);
    }
    return result;
  } finally {
    await deps.topicModel.releaseTaskCallbackReservation(topicId, reservationId);
  }
};

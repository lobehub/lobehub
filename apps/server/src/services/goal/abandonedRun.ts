import { isAgentOperationInFlight } from '@lobechat/types';

import { AgentOperationModel } from '@/database/models/agentOperation';
import { TopicModel } from '@/database/models/topic';
import type { LobeChatDatabase } from '@/database/type';
import { AgentRuntimeCoordinator } from '@/server/modules/AgentRuntime/AgentRuntimeCoordinator';
import { AiAgentService } from '@/server/services/aiAgent';

/**
 * Whether a Task topic is still `running` although its run has already ended.
 *
 * The run's terminal normally moves the topic through the task lifecycle hook,
 * but that delivery can be lost — a watchdog-abandoned device run had none at
 * all, and a dropped webhook has no retry. The lease reclaim cannot see these:
 * it only settles an operation that is itself still `running`, so the Task
 * stays in flight forever and its goal with it. Once the run has been over for
 * longer than the lease, nothing is left to report it and the topic is lost.
 *
 * A missing operation row proves nothing — a run executed on the client never
 * writes one — so only a row that says the run ended counts.
 */
export const isOrphanedRun = async (
  operationModel: AgentOperationModel,
  operationId: string,
  staleBefore: Date,
): Promise<boolean> => {
  const operation = await operationModel.findById(operationId);
  // Still-owned states (including a run parked for a client) are the lease
  // path's to reclaim, not this.
  if (!operation || isAgentOperationInFlight(operation.status)) return false;
  const endedAt = operation.completedAt ?? operation.updatedAt;
  return new Date(endedAt) < staleBefore;
};

/**
 * The metadata of a Task run's topic. A `task_topics` row carries no topic
 * metadata, so the device a run is bound to or hosted on is read from here.
 */
export const readRunTopicMetadata = async (
  db: LobeChatDatabase,
  owner: { userId: string; workspaceId?: string },
  topicId: string,
) => (await new TopicModel(db, owner.userId, owner.workspaceId).findById(topicId))?.metadata;

/** Whether the runtime still holds the run's state, or a device hosts its process. */
const hasLiveExecutor = async (
  db: LobeChatDatabase,
  owner: { userId: string; workspaceId?: string },
  run: { operationId: string; topicId: string },
): Promise<boolean> => {
  if (await new AgentRuntimeCoordinator().loadAgentState(run.operationId)) return true;
  const marker = (await readRunTopicMetadata(db, owner, run.topicId))?.runningOperation;
  const target =
    marker?.operationId === run.operationId
      ? marker
      : marker?.childOperations?.find((child) => child.operationId === run.operationId);
  return !!target?.deviceId;
};

/**
 * Claim a run whose lease expired and stop it, before its replacement starts.
 *
 * The lease reclaim only settles the operation row. A run stuck on a tool call
 * stops heartbeating, but it is not gone: when the call finally returns it
 * carries on, working the same branch as the attempt that replaced it. So a run
 * something still executes is stopped first, and only a confirmed stop lets the
 * reclaim proceed.
 *
 * The lease is claimed before the interrupt, with the same compare-and-set the
 * reclaim uses: it moves the row out of `running`, so a heartbeat landing after
 * the staleness read can no longer revive it — and a heartbeat that landed first
 * makes the claim fail, leaving the healthy run untouched.
 *
 * - `not_running`: no stale run with a live executor — the reclaim decides on its
 *   own, in its transaction, as before.
 * - `fresh`: the run heartbeated before the claim; it is alive, reclaim nothing.
 * - `stopped`: claimed, and the runtime (and the device, for a device-hosted
 *   process) acknowledged the stop — or nothing executes it any more.
 * - `unconfirmed`: claimed, but the stop was refused, unconfirmed or failed; the
 *   run may still be writing. `interruptTask` reports this as a resolved result,
 *   not a throw. The next tick finds the claimed row and retries the stop.
 */
export const stopStaleRun = async (
  db: LobeChatDatabase,
  owner: { userId: string; workspaceId?: string },
  run: { latestTotalCost?: number; operationId: string; staleBefore: Date; topicId: string },
): Promise<'fresh' | 'not_running' | 'stopped' | 'unconfirmed'> => {
  const operationModel = new AgentOperationModel(db, owner.userId, owner.workspaceId);
  const operation = await operationModel.findById(run.operationId);
  // A row this reclaim already claimed on an earlier tick, whose stop was not
  // confirmed then.
  const claimedEarlier =
    operation?.status === 'abandoned' && operation.completionReason === 'lease_expired';
  // Only a `running` row is the lease's to reclaim; a run parked for a person or
  // a client is legitimately quiet and must not be stopped.
  const stale = operation?.status === 'running' && new Date(operation.updatedAt) < run.staleBefore;
  if (!claimedEarlier && !stale) return 'not_running';

  // With no runtime state and no device hosting it, nothing executes the run any
  // more. Interrupting it then would only retire the row outside the reclaim's
  // transaction, skipping its cost charge and its rollback.
  if (!(await hasLiveExecutor(db, owner, run))) return claimedEarlier ? 'stopped' : 'not_running';

  if (
    stale &&
    !(await operationModel.settleStaleRunning(
      run.operationId,
      run.staleBefore,
      run.latestTotalCost,
    ))
  )
    return 'fresh';

  try {
    const result = await new AiAgentService(db, owner.userId, {
      workspaceId: owner.workspaceId,
    }).interruptTask({ operationId: run.operationId, topicId: run.topicId });
    return result.success && result.deviceCancellationConfirmed !== false
      ? 'stopped'
      : 'unconfirmed';
  } catch (error) {
    console.error('[GoalService] failed to interrupt stale run %s:', run.operationId, error);
    return 'unconfirmed';
  }
};

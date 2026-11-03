import type { GoalAdvanceEffect } from '@lobechat/agent-tracing';
import { DEVICE_OFFLINE_RUN_STATUS } from '@lobechat/const/goal';
import type {
  ChatTopicMetadata,
  GoalGraphSnapshot,
  GoalTickResult,
  TaskItem,
} from '@lobechat/types';

import { AgentOperationModel } from '@/database/models/agentOperation';
import { GoalModel } from '@/database/models/goal';
import { TaskModel } from '@/database/models/task';
import { TaskTopicModel } from '@/database/models/taskTopic';
import { AgentRuntimeCoordinator } from '@/server/modules/AgentRuntime/AgentRuntimeCoordinator';

import { readDeviceDispatchRoute } from '../../aiAgent/helpers/heteroErrors';
import { deviceGateway } from '../../deviceGateway';
import { isOrphanedRun, readRunTopicMetadata, stopStaleRun } from '../abandonedRun';
import { LEASE_EXPIRED_ERROR } from '../decideNextMove';
import { isDeliverySettling } from '../deliverySettle';
import { readDeviceDispatchStreak } from '../deviceDispatchStreak';
import { classifyGoalFailure } from '../failureClass';
import { lastAnsweredGateAt, planMachineRecovery } from '../machineRecovery';
import {
  classifyRunFailure,
  countConsecutiveDeviceOfflineRuns,
  DEVICE_OFFLINE_GATE_REASON,
  isDeviceUnavailableFailure,
  nextDeviceOfflineRetryAt,
  QUOTA_RESET_MARGIN_MS,
  resolveOperationLeaseTimeout,
} from '../recoveryPolicy';
import { scheduleGoalAdvance } from '../scheduler';
import { statusAuthoredByActor } from '../supervisor/policy';
import { TaskRecoveryCoordinator } from '../taskRecoveryCoordinator';
import { GoalWaitService } from '../wait';
import type { GoalServiceContext } from './types';

/** A machine hold books its own advance only from the tick that first saw the failure. */
const MACHINE_HOLD_SCHEDULE_WINDOW_MS = 15 * 60 * 1000;

/** Queue delays are bounded; the sweep covers anything further out. */
const MAX_ADVANCE_DELAY_S = 86_400;

export const recoverAbandonedTask = async (
  ctx: GoalServiceContext,
  graph: GoalGraphSnapshot,
  nodeId: string,
  task: TaskItem,
  effects: GoalAdvanceEffect[] = [],
): Promise<GoalTickResult | undefined> => {
  const [runningTopic] = await ctx.taskTopicModel.findRunningByTaskIds([task.id]);
  const operationId = runningTopic?.operationId;
  const topicId = runningTopic?.topicId;
  const staleBefore = new Date(Date.now() - resolveOperationLeaseTimeout(graph.goal));

  if (!operationId || !topicId) {
    // No running topic covers two very different shapes. A delivered Task
    // waiting on its verification (and any repair it sends back) outlives the
    // operation lease routinely; re-dispatching there pays for a duplicate
    // attempt that shadows the delivered one. Hold off while the delivery is
    // settling; past its grace window, fall through to the release below so
    // a verify run that died silently cannot strand the goal forever.
    const [lastTopic] = await ctx.taskTopicModel.findWithHandoff(task.id, 1);
    const operationModel = new AgentOperationModel(ctx.db, ctx.userId, ctx.workspaceId);
    if (await isDeliverySettling(operationModel, lastTopic)) {
      return {
        goalId: graph.goal.id,
        message: `Task ${task.identifier} delivered; waiting for verification to settle`,
        nodeId,
        outcome: 'waiting_external',
        taskId: task.id,
      };
    }

    // A task claimed for dispatch but with no run behind it. Normally this is
    // the sliver between the claim and `runTask` creating the topic; if the
    // worker died in there it is permanent, and every later advance would
    // report `waiting_external` forever because there is no operation to
    // reclaim. Once the claim is older than the lease, hand it back.
    if (new Date(task.updatedAt) >= staleBefore) return undefined;
    const released = await ctx.taskModel.updateStatusIfCurrent(task.id, 'running', 'backlog');
    if (!released) return undefined;
    return {
      goalId: graph.goal.id,
      message: `Released the abandoned dispatch claim on task ${task.identifier}`,
      nodeId,
      outcome: 'advanced',
      taskId: task.id,
    };
  }

  // A run that may still be writing must not get a replacement beside it; only
  // a device known to be offline is left to the offline-device recovery below.
  const latestUsage = await new AgentRuntimeCoordinator().getOperationMetadata(operationId);
  const owner = { userId: ctx.userId, workspaceId: ctx.workspaceId };
  const latestTotalCost = latestUsage?.totalCost;
  const stop = await stopStaleRun(ctx.db, owner, {
    latestTotalCost,
    operationId,
    staleBefore,
    topicId,
  });
  if (stop === 'fresh') return undefined;
  if (stop === 'unconfirmed') {
    const metadata = await readRunTopicMetadata(ctx.db, owner, topicId);
    if ((await ctx.readRunDevicePresence({ metadata, operationId })) !== 'offline')
      return undefined;
  }

  const reclaimed = await ctx.db.transaction(async (tx) => {
    const operationModel = new AgentOperationModel(tx, ctx.userId, ctx.workspaceId);
    const settled = await operationModel.settleStaleRunning(
      operationId,
      staleBefore,
      latestTotalCost,
    );
    // `stopStaleRun` already claimed the lease atomically when it had to stop.
    if (
      !settled &&
      stop === 'not_running' &&
      !(await isOrphanedRun(operationModel, operationId, staleBefore))
    )
      return false;

    await new TaskTopicModel(tx, ctx.userId, ctx.workspaceId).updateStatus(
      task.id,
      topicId,
      'timeout',
    );
    await new TaskModel(tx, ctx.userId, ctx.workspaceId).updateStatus(task.id, 'paused', {
      error: LEASE_EXPIRED_ERROR,
    });
    return true;
  });
  if (!reclaimed) return undefined;

  return ctx.recoverLostRun(graph, nodeId, task, effects);
};

/**
 * Recover a Task whose run was lost rather than judged — its lease expired or
 * the gateway watchdog abandoned it.
 *
 * A run lost because its device went offline mid-run is the same failure as a
 * dispatch that never reached the device, only noticed later: the laptop went
 * to sleep with the run on it. It is re-marked as an offline run so it neither
 * spends the attempt budget nor retries into a device that is still gone.
 */
export const recoverLostRun = async (
  ctx: GoalServiceContext,
  graph: GoalGraphSnapshot,
  nodeId: string,
  task: TaskItem,
  effects: GoalAdvanceEffect[] = [],
): Promise<GoalTickResult> => {
  await ctx.markRunLostToOfflineDevice(task.id);
  const held = await ctx.holdForOfflineDevice(graph, nodeId, task, effects);
  if (held) return held;
  return ctx.resumeAbandonedTaskRecovery(graph, nodeId, task, effects);
};

/**
 * Re-mark the Task's latest lost run as an offline run when the device it ran
 * on is offline now. Only a device the gateway can vouch for counts: without
 * presence the run stays a charged attempt, exactly as before.
 */
export const markRunLostToOfflineDevice = async (ctx: GoalServiceContext, taskId: string) => {
  const [latest] = await ctx.taskTopicModel.findWithHandoff(taskId, 1);
  if (!latest?.topicId || (latest.status !== 'timeout' && latest.status !== 'failed')) return;
  if ((await ctx.readRunDevicePresence(latest)) !== 'offline') return;
  await ctx.taskTopicModel.updateStatus(taskId, latest.topicId, DEVICE_OFFLINE_RUN_STATUS);
};

export const resumeAbandonedTaskRecovery = async (
  ctx: GoalServiceContext,
  graph: GoalGraphSnapshot,
  nodeId: string,
  task: TaskItem,
  effects: GoalAdvanceEffect[] = [],
): Promise<GoalTickResult> => {
  const recovery = await new TaskRecoveryCoordinator(ctx.db, ctx.userId, ctx.workspaceId).recover({
    goal: graph.goal,
    task,
  });
  if (recovery.outcome === 'started' || recovery.outcome === 'already-running') {
    await ctx.coordinatorGraph.updateNodeStatus(
      graph.goal.id,
      nodeId,
      'active',
      'Recovered an abandoned Task operation and started the next attempt',
    );
    await ctx.transitionStatus(graph.goal, 'running', 'reclaimed an abandoned Task');
    if (recovery.outcome === 'started') {
      effects.push({
        detail: 'abandoned operation retry',
        nodeId,
        operationId: recovery.operationId,
        targetId: task.id,
        type: 'started_run',
      });
    }
    return {
      goalId: graph.goal.id,
      message: `Recovered abandoned task ${task.identifier}`,
      nodeId,
      outcome: 'waiting_external',
      taskId: task.id,
    };
  }

  // The retry never reached a device. The Task keeps that reason, and the next
  // advance waits for the device to come back rather than asking a person.
  if (recovery.outcome === 'spawn-failed' && recovery.deviceUnavailable) {
    return {
      goalId: graph.goal.id,
      message: `Task ${task.identifier} is waiting for its device to reconnect`,
      nodeId,
      outcome: 'waiting_external',
      taskId: task.id,
    };
  }

  // The goal was paused or ended (a close fenced it) while this advance was
  // deciding: start nothing and do not reopen it.
  if (recovery.outcome === 'goal-stopped') {
    return {
      goalId: graph.goal.id,
      message: 'Goal stopped while recovery was being decided',
      nodeId,
      outcome: 'no_progress',
      taskId: task.id,
    };
  }

  // Nothing failed: somebody settled the Task while this advance was deciding.
  // Opening a gate would ask them to judge their own decision.
  if (recovery.outcome === 'settled') {
    return {
      goalId: graph.goal.id,
      message: `Task ${task.identifier} was settled while recovery was being decided`,
      nodeId,
      outcome: 'no_progress',
      taskId: task.id,
    };
  }
  const reason =
    recovery.outcome === 'exhausted-cost'
      ? 'Goal cost budget was exhausted after an operation was abandoned'
      : recovery.outcome === 'exhausted-rounds'
        ? 'Task attempt budget was exhausted after an operation was abandoned'
        : `Automatic recovery could not restart an abandoned operation${recovery.error ? `: ${recovery.error}` : ''}`;
  return ctx.gateOrTakeOver(graph, nodeId, task.id, reason, effects, {
    machine: recovery.outcome === 'spawn-failed',
  });
};

/** The machine-recovery plan for a paused Task, over its runs since a person last answered its gate. */
export const planMachineRecoveryFor = async (
  ctx: GoalServiceContext,
  graph: GoalGraphSnapshot,
  nodeId: string,
  task: TaskItem,
  now = new Date(),
) => {
  // A person's Retry restarts the schedule they overrode.
  const answeredAt = lastAnsweredGateAt(graph, nodeId);
  const runs = (await ctx.taskTopicModel.findByTaskId(task.id)).filter(
    (run) => !answeredAt || new Date(run.updatedAt) > answeredAt,
  );
  return planMachineRecovery({ error: task.error, now, runs, taskUpdatedAt: task.updatedAt });
};

/**
 * Recover a Task stopped by a machine problem without asking anyone to judge it
 * (see `planMachineRecovery`): a usage limit is waited out until it resets, a
 * transport fault is retried a few times, and neither run spends the attempt
 * budget. A broken setup — or a schedule that ran out — opens a machine gate
 * that says what to fix. Judgment failures return nothing and keep the
 * supervisor and the ordinary gate.
 */
export const holdForMachineFailure = async (
  ctx: GoalServiceContext,
  graph: GoalGraphSnapshot,
  nodeId: string,
  task: TaskItem,
  effects: GoalAdvanceEffect[],
): Promise<GoalTickResult | undefined> => {
  if (task.status !== 'paused' || !task.error) return;
  // A supervised goal already has an owner for transport faults: the supervisor
  // diagnoses and retries them (see `recoveryEligibility`), so the deterministic
  // schedule stays out of its way rather than racing it for the same Task.
  const supervised = !!graph.goal.config?.supervision?.enabled || !!graph.goal.config?.manager;
  if (supervised && classifyGoalFailure(task.error).class === 'transient') return;
  const now = new Date();
  const plan = await ctx.planMachineRecoveryFor(graph, nodeId, task, now);
  if (plan.action === 'none') return;
  // A pause somebody made is theirs; the error text it kept proves nothing.
  if (statusAuthoredByActor(await ctx.taskModel.getActivities(task.id, 20), task.status)) return;

  if (plan.action === 'gate')
    return ctx.gateOrTakeOver(graph, nodeId, task.id, plan.reason, effects, { machine: true });
  if (plan.action === 'retry') return ctx.resumeAbandonedTaskRecovery(graph, nodeId, task, effects);

  // The sweep re-ticks a held goal, but only on its own cadence; the tick that
  // first sees the failure also books an advance for the retry time. Later
  // sweep ticks do not, so a long hold does not pile up queued advances.
  if (now.getTime() - plan.failedAt.getTime() <= MACHINE_HOLD_SCHEDULE_WINDOW_MS) {
    await scheduleGoalAdvance({
      delay: Math.max(
        1,
        Math.min(MAX_ADVANCE_DELAY_S, Math.ceil((plan.retryAt.getTime() - now.getTime()) / 1000)),
      ),
      goalId: graph.goal.id,
      trigger: 'wake',
      userId: ctx.userId,
      workspaceId: ctx.workspaceId,
    });
  }
  return {
    goalId: graph.goal.id,
    message: `Task ${task.identifier}: ${plan.message}`,
    nodeId,
    outcome: 'waiting_external',
    taskId: task.id,
  };
};

/**
 * Hold a Task whose run could not reach its device until a device is back.
 *
 * A sleeping laptop or a restarting desktop app is the usual cause, and it
 * fixes itself: the gate it used to open waited hours for someone to press
 * Retry once the device had long reconnected. While the device is offline the
 * goal waits — the sweep keeps asking — and spends nothing; the retry then
 * goes through the ordinary recovery path.
 */
export const waitForDevice = async (
  ctx: GoalServiceContext,
  graph: GoalGraphSnapshot,
  nodeId: string,
  task: TaskItem,
  effects: GoalAdvanceEffect[],
): Promise<GoalTickResult | undefined> => {
  if (task.status !== 'paused' || !isDeviceUnavailableFailure(task.error)) return;
  const held = await ctx.holdForOfflineDevice(graph, nodeId, task, effects);
  if (held) return held;
  return ctx.resumeAbandonedTaskRecovery(graph, nodeId, task, effects);
};

/**
 * Hold a Task whose run a usage window refused until that window reopens.
 *
 * An external Agent past its session limit refuses every run until the reset
 * its error reports. The supervisor used to read that as "spending requires
 * user action" and open a gate, which then waited on a person to press Retry
 * long after the window had reset. The coordinator now waits out the reset
 * itself and retries through the ordinary recovery path, which charges the
 * attempt as before. That bounds a window that keeps refusing.
 */
export const waitForQuotaReset = async (
  ctx: GoalServiceContext,
  graph: GoalGraphSnapshot,
  nodeId: string,
  task: TaskItem,
  effects: GoalAdvanceEffect[],
): Promise<GoalTickResult | undefined> => {
  if (task.status !== 'paused') return;
  const [latest] = await ctx.taskTopicModel.findWithHandoff(task.id, 1);
  if (!latest?.operationId) return;
  const operation = await new AgentOperationModel(ctx.db, ctx.userId, ctx.workspaceId).findById(
    latest.operationId,
  );
  const failure = classifyRunFailure(operation?.error, task.error ?? '');
  if (failure.kind !== 'quota_reset') return;
  // A refusal whose text names the limit is recorded as an uncharged run
  // (`resolveFailedRunStatus`), so the attempt budget no longer bounds a window
  // that keeps refusing; the uncharged quota schedule does. Once it is spent,
  // fall through and `holdForMachineFailure` asks a person to fix the account.
  if (
    classifyGoalFailure(task.error).class === 'quota' &&
    (await ctx.planMachineRecoveryFor(graph, nodeId, task)).action === 'gate'
  )
    return;
  const retryAt = failure.resetsAt! + QUOTA_RESET_MARGIN_MS;
  if (retryAt <= Date.now()) {
    // The retry is a paid run, and recovery only checks the Task's own attempts
    // and cost. Past the Goal's deadline, rounds or spend it is not this path's
    // to start: ordinary failure handling takes it, and that gates it.
    const budget = await ctx.evaluateBudget(graph.goal, graph);
    if (budget.costLimitReached || budget.roundLimitReached || budget.deadlinePassed) return;
    return ctx.resumeAbandonedTaskRecovery(graph, nodeId, task, effects);
  }
  // The sweep would get here too, but only on its own cadence; the reset is a
  // known time, so ask for that tick directly. One wake per Goal: the claim
  // fails while an earlier-or-equal wake is still pending. A reset further out
  // than the queue's longest delay is re-armed when the capped wake fires.
  const target = new Date(retryAt).toISOString();
  const armed = GoalWaitService.arm(target);
  // Claim on the reset itself, not on `armedUntil`: that rounds the delay up to
  // whole seconds from each tick's own clock, so two ticks before the same reset
  // would read as different wakes. Only a capped wake stores its earlier fire time.
  const capped = Date.parse(armed.armedUntil) < retryAt;
  if (
    await new GoalModel(ctx.db, ctx.userId, ctx.workspaceId).armQuotaRetryWake(
      graph.goal.id,
      capped ? armed.armedUntil : target,
    )
  )
    await new GoalWaitService(ctx.db, ctx.userId, ctx.workspaceId).schedule(
      graph.goal.id,
      armed.delay,
    );
  return {
    goalId: graph.goal.id,
    message: `Task ${task.identifier} is waiting for its usage window to reset at ${new Date(retryAt).toISOString()}`,
    nodeId,
    outcome: 'waiting_external',
    taskId: task.id,
  };
};

/**
 * The offline retry schedule. Offline runs are not charged to the attempt
 * budget, so this is what bounds them: each consecutive one pushes the next
 * retry further out (see `nextDeviceOfflineRetryAt`), and once the offline
 * retries are spent a person is asked. Presence only brings a retry forward —
 * a device seen back online is retried at once — so a deployment without a
 * device gateway, or a run with no recorded device, still retries on schedule.
 *
 * Returns nothing when the Task should retry now.
 */
export const holdForOfflineDevice = async (
  ctx: GoalServiceContext,
  graph: GoalGraphSnapshot,
  nodeId: string,
  task: TaskItem,
  effects: GoalAdvanceEffect[],
): Promise<GoalTickResult | undefined> => {
  const runs = await ctx.taskTopicModel.findByTaskId(task.id);
  const offlineRuns = countConsecutiveDeviceOfflineRuns(runs);
  // A dispatch failure is an offline run even when it left no run behind. Those
  // are kept on the dispatch streak, which holds only failures without a run,
  // so the two counts add up and the latest of either dates the schedule. The
  // newest run that was not offline ends the streak for both.
  const dispatch = readDeviceDispatchStreak(task, runs[offlineRuns]?.createdAt);
  if (!offlineRuns && !dispatch.failures && !isDeviceUnavailableFailure(task.error)) return;

  const failureTimes = [
    ...(offlineRuns ? [new Date(runs[0].updatedAt).getTime()] : []),
    ...(dispatch.failures && dispatch.lastFailedAt ? [dispatch.lastFailedAt.getTime()] : []),
  ];
  const lastFailureAt = new Date(
    failureTimes.length ? Math.max(...failureTimes) : new Date(task.updatedAt).getTime(),
  );
  const retryAt = nextDeviceOfflineRetryAt(offlineRuns + dispatch.failures, lastFailureAt);
  if (!retryAt)
    return ctx.gateOrTakeOver(graph, nodeId, task.id, DEVICE_OFFLINE_GATE_REASON, effects, {
      machine: true,
    });
  if (retryAt.getTime() <= Date.now()) return;

  const [latest] = await ctx.taskTopicModel.findWithHandoff(task.id, 1);
  if (latest && (await ctx.readRunDevicePresence(latest)) === 'online') return;

  return {
    goalId: graph.goal.id,
    message: `Task ${task.identifier} is waiting for its device to reconnect; next retry at ${retryAt.toISOString()}`,
    nodeId,
    outcome: 'waiting_external',
    taskId: task.id,
  };
};

/**
 * Whether the device a run was routed to is connected right now.
 *
 * Presence is read for the exact device the run used, in the pool it was
 * routed through: a workspace goal may run on a personal device, and another
 * device coming online proves nothing about this one. A failed dispatch
 * records its route on the operation error; a run that got going leaves its
 * device on the topic. A topic bound to a device without a recorded pool is
 * looked up in every pool this goal can route through.
 */
export const readRunDevicePresence = async (
  ctx: GoalServiceContext,
  run: {
    metadata?: ChatTopicMetadata | null;
    operationId?: string | null;
  },
): Promise<'offline' | 'online' | 'unknown'> => {
  if (!deviceGateway.isConfigured) return 'unknown';

  const operation = run.operationId
    ? await new AgentOperationModel(ctx.db, ctx.userId, ctx.workspaceId).findById(run.operationId)
    : undefined;
  const dispatchRoute = readDeviceDispatchRoute(operation?.error);
  const running = run.metadata?.runningOperation;
  const runningDevice =
    running?.deviceId && running.operationId === run.operationId ? running : undefined;

  let deviceId: string | undefined;
  let pools: { userId: string; workspaceId?: string }[];
  if (dispatchRoute) {
    deviceId = dispatchRoute.deviceId;
    pools = [{ userId: dispatchRoute.userId, workspaceId: dispatchRoute.workspaceId }];
  } else if (runningDevice) {
    deviceId = runningDevice.deviceId;
    pools = [
      {
        userId: runningDevice.deviceUserId ?? ctx.userId,
        workspaceId: runningDevice.deviceWorkspaceId,
      },
    ];
  } else {
    deviceId = run.metadata?.boundDeviceId;
    pools = [
      { userId: ctx.userId },
      ...(ctx.workspaceId ? [{ userId: ctx.userId, workspaceId: ctx.workspaceId }] : []),
    ];
  }
  if (!deviceId) return 'unknown';

  for (const pool of pools) {
    const devices = await deviceGateway.queryDeviceList(pool.userId, pool.workspaceId);
    if (devices.some((device) => device.deviceId === deviceId)) return 'online';
  }
  return 'offline';
};

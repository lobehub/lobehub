import { TRPCError } from '@trpc/server';
import debug from 'debug';
import { and, eq } from 'drizzle-orm';

import { BriefModel } from '@/database/models/brief';
import { tasks } from '@/database/schemas';
import { getServerDB } from '@/database/server';
import { setTaskSchedulerExecutionCallback } from '@/server/services/taskScheduler';

import { TaskRunnerService } from './index';

const log = debug('task-runner:heartbeat-tick');

const TERMINAL_STATUSES = new Set(['canceled', 'completed', 'failed']);
const isTerminal = (status: string) => TERMINAL_STATUSES.has(status);

export type HeartbeatTickOutcome =
  | { ran: true; taskIdentifier: string }
  | { ran: false; reason: HeartbeatTickSkipReason };

export type HeartbeatTickSkipReason =
  | 'human-waiting'
  | 'in-flight'
  | 'mode-changed'
  | 'no-interval'
  | 'not-found'
  | 'terminal';

/**
 * Run a heartbeat tick — invoked by both the LocalScheduler `setTimeout`
 * callback and the QStash `/heartbeat-tick` HTTP handler.
 *
 * DB is the authority: every check below re-reads task state because the
 * scheduled message may arrive after the user paused, canceled, or changed
 * the task's automation mode.
 */
export async function runHeartbeatTick(
  taskId: string,
  userId: string,
): Promise<HeartbeatTickOutcome> {
  const db = await getServerDB();

  // System-level dispatch: read the task row directly to learn its
  // `workspaceId` before constructing downstream models.
  const [task] = await db
    .select()
    .from(tasks)
    .where(and(eq(tasks.id, taskId), eq(tasks.createdByUserId, userId)))
    .limit(1);
  if (!task) {
    log('skip task=%s reason=not-found', taskId);
    return { ran: false, reason: 'not-found' };
  }
  if (task.automationMode !== 'heartbeat') {
    log('skip task=%s reason=mode-changed (mode=%s)', taskId, task.automationMode);
    return { ran: false, reason: 'mode-changed' };
  }
  if (isTerminal(task.status)) {
    log('skip task=%s reason=terminal (status=%s)', taskId, task.status);
    return { ran: false, reason: 'terminal' };
  }
  if (!task.heartbeatInterval || task.heartbeatInterval <= 0) {
    log('skip task=%s reason=no-interval', taskId);
    return { ran: false, reason: 'no-interval' };
  }

  const wsId = task.workspaceId ?? undefined;
  const briefModel = new BriefModel(db, userId, wsId);
  if (await briefModel.hasUnresolvedUrgentByTask(taskId)) {
    log('skip task=%s reason=human-waiting', taskId);
    return { ran: false, reason: 'human-waiting' };
  }

  const runner = new TaskRunnerService(db, userId, wsId);
  try {
    await runner.runTask({ taskId });
  } catch (e) {
    // Concurrent tick / manual run already running this task — treat as a
    // graceful skip. runTask's own rollback only fires when *it* set running,
    // so the in-flight run keeps its 'running' status untouched.
    if (e instanceof TRPCError && e.code === 'CONFLICT') {
      log('skip task=%s reason=in-flight', taskId);
      return { ran: false, reason: 'in-flight' };
    }
    throw e;
  }
  log('ran task=%s identifier=%s', taskId, task.identifier);
  return { ran: true, taskIdentifier: task.identifier };
}

// Side effect: wire `runHeartbeatTick` into the LocalScheduler's setTimeout
// callback. Importing this module from anywhere in the server bundle (the
// heartbeat-tick handler is the natural place) ensures local-mode heartbeat
// loops actually fire.
setTaskSchedulerExecutionCallback(async (taskId, userId) => {
  await runHeartbeatTick(taskId, userId);
});

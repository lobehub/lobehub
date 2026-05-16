import { TRPCError } from '@trpc/server';
import debug from 'debug';

import { BriefModel } from '@/database/models/brief';
import { TaskModel } from '@/database/models/task';
import { TaskTopicModel } from '@/database/models/taskTopic';
import { getServerDB } from '@/database/server';

import { TaskRunnerService } from './index';

const log = debug('task-runner:schedule-tick');

const TERMINAL_STATUSES = new Set(['canceled', 'completed', 'failed']);
const isTerminal = (status: string) => TERMINAL_STATUSES.has(status);

export type ScheduleTickOutcome =
  | { ran: true; taskIdentifier: string }
  | { ran: false; reason: ScheduleTickSkipReason };

export type ScheduleTickSkipReason =
  | 'human-waiting'
  | 'in-flight'
  | 'max-executions-reached'
  | 'mode-changed'
  | 'no-pattern'
  | 'not-found'
  | 'paused'
  | 'terminal';

/**
 * Run a schedule tick — invoked by the QStash `/schedule-execute` HTTP handler
 * after the central `/schedule-dispatch` decided this task is due.
 *
 * DB is the authority: re-checks task state because the dispatch message may
 * arrive after the user paused, canceled, or changed the automation mode.
 */
export async function runScheduleTick(
  taskId: string,
  userId: string,
): Promise<ScheduleTickOutcome> {
  const db = await getServerDB();

  const taskModel = new TaskModel(db, userId);
  const task = await taskModel.findById(taskId);
  if (!task) {
    log('skip task=%s reason=not-found', taskId);
    return { ran: false, reason: 'not-found' };
  }
  if (task.automationMode !== 'schedule') {
    log('skip task=%s reason=mode-changed (mode=%s)', taskId, task.automationMode);
    return { ran: false, reason: 'mode-changed' };
  }
  if (!task.schedulePattern) {
    log('skip task=%s reason=no-pattern', taskId);
    return { ran: false, reason: 'no-pattern' };
  }
  if (isTerminal(task.status)) {
    log('skip task=%s reason=terminal (status=%s)', taskId, task.status);
    return { ran: false, reason: 'terminal' };
  }
  if (task.status === 'paused') {
    log('skip task=%s reason=paused', taskId);
    return { ran: false, reason: 'paused' };
  }

  const briefModel = new BriefModel(db, userId);
  if (await briefModel.hasUnresolvedUrgentByTask(taskId)) {
    log('skip task=%s reason=human-waiting', taskId);
    return { ran: false, reason: 'human-waiting' };
  }

  // Defense-in-depth cap check.
  //
  // `TaskLifecycleService.onTopicComplete` is the primary stopper — it parks
  // a schedule-mode task at `completed` (instead of `scheduled`) the instant
  // it consumes its final allowed run, so the UI reflects the cap immediately
  // even on low-frequency crons (e.g. daily, maxExecutions=1).
  //
  // This pre-tick recheck catches the residual edge cases the lifecycle
  // hook can miss: a crashed tick that never reached onTopicComplete; a
  // user editing maxExecutions downward after the cap is already exceeded;
  // or stale `scheduled` rows from older code paths.
  const scheduleConfig =
    ((task.config as { schedule?: { maxExecutions?: number | null } } | null) ?? {}).schedule ?? {};
  const maxExecutions = scheduleConfig.maxExecutions ?? null;
  if (maxExecutions != null && maxExecutions > 0) {
    const scheduler =
      ((task.context as { scheduler?: { scheduleStartedAt?: string } } | null) ?? {}).scheduler ??
      {};
    const startedAtIso = scheduler.scheduleStartedAt;
    if (startedAtIso) {
      const startedAt = new Date(startedAtIso);
      const topicModel = new TaskTopicModel(db, userId);
      const runCount = await topicModel.countByTask(taskId, { since: startedAt });
      if (runCount >= maxExecutions) {
        log(
          'skip task=%s reason=max-executions-reached (%d/%d) — marking completed',
          taskId,
          runCount,
          maxExecutions,
        );
        await taskModel.updateStatus(taskId, 'completed', { completedAt: new Date() });
        return { ran: false, reason: 'max-executions-reached' };
      }
    }
  }

  const runner = new TaskRunnerService(db, userId);
  try {
    await runner.runTask({ taskId });
  } catch (e) {
    // Concurrent tick / manual run already running this task — graceful skip.
    if (e instanceof TRPCError && e.code === 'CONFLICT') {
      log('skip task=%s reason=in-flight', taskId);
      return { ran: false, reason: 'in-flight' };
    }
    throw e;
  }
  log('ran task=%s identifier=%s', taskId, task.identifier);
  return { ran: true, taskIdentifier: task.identifier };
}

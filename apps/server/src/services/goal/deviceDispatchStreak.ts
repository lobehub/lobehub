import type { TaskItem } from '@lobechat/types';

import type { TaskModel } from '@/database/models/task';

import { MAX_DEVICE_OFFLINE_RETRIES } from './recoveryPolicy';

/**
 * Dispatches of a Task that could not reach its device and left no run behind,
 * kept on `task.context` as the times they failed.
 *
 * The offline schedule (`holdForOfflineDevice`) counts offline runs, but a
 * dispatch can fail before `runTask` records a run. Counted from runs alone,
 * such a Task stayed at the first retry forever: every failure refreshed
 * `task.updatedAt`, so the schedule restarted at 30 minutes and never reached
 * its retry cap or the gate.
 *
 * Only failures without a run are kept here, so they never overlap the offline
 * runs and the schedule adds the two. Taking the larger one instead undercounted
 * a mix: a run lost offline plus a retry that left no run read as one failure,
 * dated by the old run, and was retried at once.
 *
 * The times, not a counter, decide what is still consecutive: any run that is
 * not offline breaks the streak, and the reader drops failures from before it.
 * A counter cleared by each writer missed the paths that record such a run
 * without a successful kickoff (a startup error after the run row, a lifecycle
 * hook), and a stale failure doubled the next backoff.
 */
const CONTEXT_KEY = 'deviceDispatch';

/** Enough to reach the offline gate; older failures can no longer change it. */
const MAX_KEPT_FAILURES = MAX_DEVICE_OFFLINE_RETRIES + 1;

interface DeviceDispatchStreak {
  failedAt: string[];
}

const readFailedAt = (task: Pick<TaskItem, 'context'>): string[] => {
  const streak = (task.context as Record<string, unknown> | null)?.[CONTEXT_KEY] as
    Partial<DeviceDispatchStreak> | undefined;
  return Array.isArray(streak?.failedAt)
    ? streak.failedAt.filter((value) => !Number.isNaN(Date.parse(value)))
    : [];
};

/**
 * Run-less device failures since `since` (the newest run that was not offline),
 * and when the latest of them happened.
 */
export const readDeviceDispatchStreak = (
  task: Pick<TaskItem, 'context'>,
  since?: Date | string,
): { failures: number; lastFailedAt?: Date } => {
  const after = since ? new Date(since).getTime() : -Infinity;
  const times = readFailedAt(task)
    .map((value) => Date.parse(value))
    .filter((time) => time > after);
  return {
    failures: times.length,
    lastFailedAt: times.length ? new Date(Math.max(...times)) : undefined,
  };
};

const writeFailedAt = async (
  taskModel: TaskModel,
  task: Pick<TaskItem, 'context' | 'id'>,
  failedAt: string[],
) => {
  // Replace the key outright: the context merge would keep a longer old array.
  const context = {
    ...(task.context as Record<string, unknown> | null),
    [CONTEXT_KEY]: { failedAt } satisfies DeviceDispatchStreak,
  };
  await taskModel.update(task.id, { context });
};

/**
 * Park a claimed Task whose dispatch could not reach its device: `paused` with
 * the device error, so the next advance takes the offline schedule. A dispatch
 * that recorded no run (`totalTopics` unchanged since `task` was read) is one
 * more failure on the streak; one that did is already counted as an offline run.
 */
export const parkDeviceUnavailableDispatch = async (
  taskModel: TaskModel,
  task: Pick<TaskItem, 'id' | 'totalTopics'>,
  error: string,
) => {
  const parked = await taskModel.updateStatusIfCurrent(task.id, 'running', 'paused', { error });
  if (!parked || (parked.totalTopics ?? 0) > (task.totalTopics ?? 0)) return;
  const failedAt = [...readFailedAt(parked), new Date().toISOString()].slice(-MAX_KEPT_FAILURES);
  await writeFailedAt(taskModel, parked, failedAt);
};

/** A dispatch got through: the next device failure starts a new streak. */
export const clearDeviceDispatchStreak = async (taskModel: TaskModel, taskId: string) => {
  const task = await taskModel.findById(taskId);
  if (!task || readFailedAt(task).length === 0) return;
  await writeFailedAt(taskModel, task, []);
};

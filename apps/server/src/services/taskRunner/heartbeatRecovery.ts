import { randomUUID } from 'node:crypto';

import type { TaskContext, TaskSchedulerContext } from '@lobechat/types';
import debug from 'debug';

import { BriefModel } from '@/database/models/brief';
import { TaskModel } from '@/database/models/task';
import { getServerDB } from '@/database/server';
import { appEnv } from '@/envs/app';
import { AUTOMATION_FAILURE_FUSE } from '@/server/services/taskLifecycle';
import { createTaskSchedulerModule } from '@/server/services/taskScheduler';

const log = debug('task-runner:heartbeat-recovery');

/**
 * Floor under every rehydrated tick's delay, in seconds.
 *
 * Two reasons it exists:
 * - `createTaskSchedulerModule` lazily dynamic-imports the heartbeat tick
 *   runner to wire the execution callback; a delay-0 timer could fire before
 *   that import resolves and the tick would be dropped with
 *   "No execution callback set".
 * - A restart storm (deploy loop, crash loop) should not stampede the DB and
 *   the agent runtime the instant the process is up.
 */
const REHYDRATE_MIN_DELAY_SECONDS = 3;

export interface HeartbeatRecoveryResult {
  rehydrated: number;
}

/**
 * Re-arm pending heartbeat ticks after a process restart in local queue mode.
 *
 * The LocalTaskScheduler holds ticks in in-memory `setTimeout` timers, so a
 * restart (intentional or crash) loses every pending tick and the heartbeat
 * chain stalls in its resting 'scheduled' state forever. QStash mode is
 * unaffected — its ticks are persisted server-side and re-deliver on their
 * own — so this sweep is a no-op there.
 *
 * For every armed heartbeat task (`automationMode='heartbeat'`, status
 * 'scheduled' — the only resting state a tick is ever published from, see
 * {@link TaskModel.findRunnableHeartbeatTasks} — positive interval, fuse
 * intact, no unresolved urgent brief; the last two mirror
 * `maybeRearmHeartbeat`'s gates, whose skip leaves no pending tick at rest in
 * QStash mode either) a fresh tick is scheduled and the scheduler context is
 * rewritten with a new `tickToken` / `tickMessageId`:
 * - ticks that came due while the process was down fire after the floor delay;
 * - ticks still in the future keep their remaining wait, resuming the cadence
 *   where `scheduledAt + heartbeatInterval` says it left off.
 *
 * Safe to run redundantly: the fresh token invalidates any zombie timer (dev
 * hot-reload keeps old module instances, and their timers, alive), and the
 * tick runner re-validates all task state from the DB when it fires.
 */
export async function rehydrateHeartbeatTasks(): Promise<HeartbeatRecoveryResult> {
  // QStash persists ticks server-side; they survive restarts without help.
  if (appEnv.enableQueueAgentRuntime) return { rehydrated: 0 };

  const db = await getServerDB();
  const heartbeatTasks = await TaskModel.findRunnableHeartbeatTasks(db);
  if (heartbeatTasks.length === 0) return { rehydrated: 0 };

  log('rehydrating %d heartbeat task(s) after restart', heartbeatTasks.length);
  const scheduler = createTaskSchedulerModule();

  let rehydrated = 0;
  for (const task of heartbeatTasks) {
    try {
      const interval = task.heartbeatInterval ?? 0;
      if (interval <= 0) continue;

      const sched =
        ((task.context as TaskContext | null)?.scheduler as TaskSchedulerContext | undefined) ?? {};

      // Mirror the re-arm gates in TaskLifecycleService.maybeRearmHeartbeat —
      // both leave the task resting with NO pending tick in QStash mode, so
      // recovery must not resurrect them either:
      // - a blown failure fuse stops re-arming until a human resolves it;
      // - an unresolved urgent brief means a human is already waiting.
      if ((sched.consecutiveFailures ?? 0) >= AUTOMATION_FAILURE_FUSE) {
        log('skip task=%s reason=fuse-blown', task.identifier);
        continue;
      }
      const briefModel = new BriefModel(db, task.createdByUserId, task.workspaceId ?? undefined);
      if (await briefModel.hasUnresolvedUrgentByTask(task.id, { excludeTypes: ['error'] })) {
        log('skip task=%s reason=human-waiting', task.identifier);
        continue;
      }

      const armedAt = sched.scheduledAt ? Date.parse(sched.scheduledAt) : Number.NaN;
      const dueAt = Number.isFinite(armedAt) ? armedAt + interval * 1000 : Date.now();
      const delay = Math.min(
        Math.max((dueAt - Date.now()) / 1000, REHYDRATE_MIN_DELAY_SECONDS),
        interval,
      );

      const taskModel = new TaskModel(db, task.createdByUserId, task.workspaceId ?? undefined);
      const tickToken = randomUUID();

      // Invalidate the dead tick generation before scheduling, mirroring the
      // QStash race discipline in TaskService/TaskLifecycleService: a zombie
      // delivery must lose to the replacement message.
      await taskModel.updateContext(task.id, { scheduler: { tickToken } });
      const tickMessageId = await scheduler.scheduleNextTopic({
        delay,
        taskId: task.id,
        tickToken,
        userId: task.createdByUserId,
      });
      await taskModel.updateContext(task.id, {
        scheduler: {
          consecutiveFailures: sched.consecutiveFailures ?? 0,
          scheduledAt: new Date().toISOString(),
          tickMessageId,
          tickToken,
        },
      });

      rehydrated += 1;
      log(
        'rehydrated task=%s delay=%ds messageId=%s',
        task.identifier,
        Math.round(delay),
        tickMessageId,
      );
    } catch (error) {
      // One broken task must not stall the sweep — the rest still recover.
      console.error('[heartbeat-recovery] failed to rehydrate task %s:', task.id, error);
    }
  }

  return { rehydrated };
}

const globalForHeartbeatRecovery = globalThis as typeof globalThis & {
  __lobeHeartbeatRecoveryStarted?: boolean;
};

/**
 * Startup wrapper around {@link rehydrateHeartbeatTasks}: runs the sweep at
 * most once per process, fire-and-forget (callers never await it).
 *
 * Guard lives on `globalThis` so Next.js instrumentation, the standalone
 * Hono bootstrap, and dev hot-reloads can all call it without double-running.
 * A failed sweep releases the guard so a later trigger can retry.
 */
export const scheduleHeartbeatRecoveryOnce = (): Promise<void> => {
  if (globalForHeartbeatRecovery.__lobeHeartbeatRecoveryStarted) return Promise.resolve();
  globalForHeartbeatRecovery.__lobeHeartbeatRecoveryStarted = true;

  return rehydrateHeartbeatTasks()
    .then((result) => {
      log('startup rehydration complete: %d task(s) re-armed', result.rehydrated);
    })
    .catch((error) => {
      globalForHeartbeatRecovery.__lobeHeartbeatRecoveryStarted = false;
      console.error('[heartbeat-recovery] startup rehydration failed:', error);
    });
};

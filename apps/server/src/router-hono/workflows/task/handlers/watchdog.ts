import debug from 'debug';
import type { Context } from 'hono';

import { getServerDB } from '@/database/server';
import { failStuckTasks } from '@/server/services/taskLifecycle/failStuckTasks';
import { reconcileOrphanedTaskRuns } from '@/server/services/taskLifecycle/reconcile';
import { reconcileInterruptedTaskRuns } from '@/server/services/taskLifecycle/reconcileInterrupted';
import { TaskResultBridgeService } from '@/server/services/taskResultBridge';
import { TaskResultCallbackRedisStore } from '@/server/services/taskResultBridge/redisStore';

const log = debug('lobe-server:workflows:task:watchdog');

/**
 * Cron-style watchdog. Two nets over Tasks that are `running` with nothing
 * behind them:
 *
 * 1. `lastHeartbeatAt + heartbeatTimeout < now()` — the automation-heartbeat
 *    net, which marks the Task `failed` and notifies the owner.
 * 2. A `running` run row whose operation already ended (see
 *    {@link reconcileOrphanedTaskRuns}) — the net for a Task the first one
 *    cannot see, either because it sets no `heartbeatTimeout` or because its
 *    run ends without ever delivering its terminal state.
 * 3. A `running` run row whose operation was interrupted and that no run took
 *    over (see {@link reconcileInterruptedTaskRuns}) — parked as `paused`.
 *
 * No per-user authentication: this is a global sweep registered as a QStash
 * Schedule (cron). Signature verification is handled by the `qstashAuth`
 * middleware mounted on the route.
 */
export async function watchdog(c: Context) {
  try {
    const db = await getServerDB();
    const { checked, failed } = await failStuckTasks(db);

    // The heartbeat net above cannot see every stuck Task: it requires a
    // configured `heartbeatTimeout`, which schedule and goal tasks do not set. A
    // run whose terminal delivery was lost leaves no trace here at all, so its
    // Task would read as `running` forever. Settle those from the
    // operation's own end instead.
    const reconciled = await reconcileOrphanedTaskRuns(db);
    // An interrupted run is not an outcome the net above may converge; a run
    // nothing took over is handed back to a person instead.
    const interrupted = await reconcileInterruptedTaskRuns(db);

    const recoverableCallbacks = await TaskResultCallbackRedisStore.findRecoverableScopes();
    const recoveredCallbacks: string[] = [];
    for (const scope of recoverableCallbacks) {
      if (!scope.agentId) continue;
      try {
        const workspaceId = scope.workspaceId ?? undefined;
        const callbackStore = new TaskResultCallbackRedisStore(
          scope.userId,
          scope.originTopicId,
          workspaceId,
        );
        await callbackStore.resetStaleProcessing();
        await new TaskResultBridgeService(db, scope.userId, workspaceId).drain(
          scope.agentId,
          scope.originTopicId,
        );
        recoveredCallbacks.push(scope.originTopicId);
      } catch (error) {
        console.error(
          `[task/watchdog] Failed to recover creator callback scope ${scope.originTopicId}:`,
          error,
        );
      }
    }

    log(
      'Watchdog scan: checked=%d failed=%d orphaned=%d interrupted=%d callbacks=%d',
      checked,
      failed.length,
      reconciled.converged.length,
      interrupted.paused.length,
      recoveredCallbacks.length,
    );
    return c.json({
      checked,
      failed,
      interrupted,
      orphaned: reconciled,
      recoveredCallbacks,
      success: true,
    });
  } catch (error) {
    console.error('[task/watchdog] Error:', error);
    return c.json({ error: error instanceof Error ? error.message : 'Internal error' }, 500);
  }
}

import debug from 'debug';
import type { Context } from 'hono';

import { BriefModel } from '@/database/models/brief';
import { TaskModel } from '@/database/models/task';
import { getServerDB } from '@/database/server';
import { TaskResultBridgeService } from '@/server/services/taskResultBridge';
import { TaskResultCallbackRedisStore } from '@/server/services/taskResultBridge/redisStore';

const log = debug('lobe-server:workflows:task:watchdog');

/**
 * Cron-style watchdog. Scans all `running` tasks where
 * `lastHeartbeatAt + heartbeatTimeout < now()` and marks them `failed`,
 * leaving an urgent brief for the user.
 *
 * No per-user authentication: this is a global sweep registered as a QStash
 * Schedule (cron). Signature verification is handled by the `qstashAuth`
 * middleware mounted on the route.
 */
export async function watchdog(c: Context) {
  try {
    const db = await getServerDB();
    const stuckTasks = await TaskModel.findStuckTasks(db);
    const failed: string[] = [];

    for (const task of stuckTasks) {
      const wsId = task.workspaceId ?? undefined;
      const taskModel = new TaskModel(db, task.createdByUserId, wsId);
      await taskModel.updateStatus(task.id, 'failed', {
        completedAt: new Date(),
        error: 'Heartbeat timeout',
      });

      const briefModel = new BriefModel(db, task.createdByUserId, wsId);
      await briefModel.create({
        agentId: task.assigneeAgentId || undefined,
        priority: 'urgent',
        summary: `Task has been running without heartbeat update for more than ${task.heartbeatTimeout} seconds.`,
        taskId: task.id,
        title: `${task.identifier} heartbeat timeout`,
        trigger: 'task',
        type: 'error',
      });

      failed.push(task.identifier);
    }

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
      'Watchdog scan: checked=%d failed=%d callbacks=%d',
      stuckTasks.length,
      failed.length,
      recoveredCallbacks.length,
    );
    return c.json({
      checked: stuckTasks.length,
      failed,
      recoveredCallbacks,
      success: true,
    });
  } catch (error) {
    console.error('[task/watchdog] Error:', error);
    return c.json({ error: error instanceof Error ? error.message : 'Internal error' }, 500);
  }
}

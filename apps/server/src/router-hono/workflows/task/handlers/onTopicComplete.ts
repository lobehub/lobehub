import type { TaskRunTrigger } from '@lobechat/types';
import debug from 'debug';
import { and, eq } from 'drizzle-orm';
import type { Context } from 'hono';

import { tasks } from '@/database/schemas';
import { getServerDB } from '@/database/server';
import { redisService } from '@/server/services/redis';
import { TaskLifecycleService } from '@/server/services/taskLifecycle';
import { isRunAlreadySettled } from '@/server/services/taskLifecycle/reconcile';

const log = debug('lobe-server:workflows:task:on-topic-complete');

export interface OnTopicCompletePayload {
  errorMessage?: string;
  /** Structured terminal error type (e.g. `InsufficientBudgetForModel`). Spread
   *  onto the webhook body from the completion lifecycle event (no eventFields
   *  filter), used to pick the error brief's remedy action. */
  errorType?: string;
  hookId?: string;
  hookType?: string;
  lastAssistantContent?: string;
  operationId: string;
  reason?: string;
  // Static body field set by TaskRunnerService — what triggered the run.
  runTrigger?: TaskRunTrigger;
  taskId: string;
  taskIdentifier?: string;
  topicId?: string;
  userId: string;
}

export async function onTopicComplete(c: Context) {
  try {
    const body = (await c.req.json()) as OnTopicCompletePayload;
    const {
      errorMessage,
      errorType,
      lastAssistantContent,
      operationId,
      reason,
      runTrigger,
      taskId,
      taskIdentifier,
      topicId,
      userId,
    } = body;

    if (!taskId || !userId || !operationId) {
      return c.json({ error: 'Missing required fields' }, 400);
    }

    log(
      'Received: taskId=%s topicId=%s reason=%s operationId=%s',
      taskId,
      topicId,
      reason,
      operationId,
    );

    const db = await getServerDB();
    // System-level callback: derive workspace from the task row so the
    // lifecycle service writes briefs / status into the correct workspace.
    const [taskRow] = await db
      .select({ identifier: tasks.identifier, workspaceId: tasks.workspaceId })
      .from(tasks)
      .where(and(eq(tasks.id, taskId), eq(tasks.createdByUserId, userId)))
      .limit(1);
    const wsId = taskRow?.workspaceId ?? undefined;

    // A delivery delayed past the orphaned-run grace window can land after the
    // reconciliation sweep already settled this run. Driving the lifecycle again
    // would double-apply it (a second urgent error brief, double fuse counting),
    // so ack and stop — QStash must not retry a delivery that has nothing to do.
    if (
      await isRunAlreadySettled(db, userId, wsId, {
        operationId,
        reason: reason || 'done',
        taskId,
        topicId,
      })
    ) {
      log('Skipped: run %s of task %s was already settled', operationId, taskId);
      return c.json({ skipped: 'already-settled', success: true });
    }

    // Settling a successful run (handoff + brief LLM calls) outlasts the QStash
    // delivery timeout, so the same run is redelivered while it is still being
    // settled — and the lifecycle is not idempotent: each pass emits another
    // brief. Failed runs are fenced above. A delivery that finds the settle in
    // progress answers non-2xx: if the holder dies, a later retry takes over
    // once its lease lapses. Without Redis, settle anyway: a duplicate brief
    // beats a run that never reaches its Task.
    const claim =
      (reason || 'done') === 'done'
        ? await redisService.taskRunDelivery.claim(operationId)
        : undefined;

    if (claim === 'settled') {
      log('Skipped: run %s of task %s was already settled', operationId, taskId);
      return c.json({ skipped: 'already-settled', success: true });
    }
    if (claim === 'in-progress') {
      log('Deferred: run %s of task %s is still settling', operationId, taskId);
      return c.json({ skipped: 'in-progress' }, 409);
    }

    const taskLifecycle = new TaskLifecycleService(db, userId, wsId);

    try {
      await taskLifecycle.onTopicComplete({
        errorCode: errorType,
        errorMessage,
        lastAssistantContent,
        operationId,
        reason: reason || 'done',
        runTrigger,
        taskId,
        taskIdentifier: taskRow?.identifier ?? taskIdentifier ?? taskId,
        topicId,
      });
    } catch (error) {
      if (claim === 'claimed') await redisService.taskRunDelivery.release(operationId);
      throw error;
    }

    if (claim === 'claimed') await redisService.taskRunDelivery.markSettled(operationId);

    return c.json({ success: true });
  } catch (error) {
    console.error('[task/on-topic-complete] Error:', error);
    return c.json({ error: error instanceof Error ? error.message : 'Internal error' }, 500);
  }
}

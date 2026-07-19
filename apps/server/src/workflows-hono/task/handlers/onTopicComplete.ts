import type { TaskRunTrigger } from '@lobechat/types';
import debug from 'debug';
import { and, eq } from 'drizzle-orm';
import type { Context } from 'hono';

import { tasks } from '@/database/schemas';
import { getServerDB } from '@/database/server';
import { TaskLifecycleService } from '@/server/services/taskLifecycle';

const log = debug('lobe-server:workflows:task:on-topic-complete');

export interface OnTopicCompletePayload {
  errorMessage?: string;
  hookId?: string;
  hookType?: string;
  lastAssistantContent?: string;
  operationId: string;
  reason?: string;
  // Static body field set by TaskRunnerService — what triggered the run.
  runTrigger?: TaskRunTrigger;
  taskId: string;
  taskIdentifier: string;
  topicId?: string;
  userId: string;
}

export async function onTopicComplete(c: Context) {
  try {
    const body = (await c.req.json()) as OnTopicCompletePayload;
    const {
      errorMessage,
      lastAssistantContent,
      operationId,
      reason,
      runTrigger,
      taskId,
      taskIdentifier,
      topicId,
      userId,
    } = body;

    if (!taskId || !userId || !taskIdentifier || !operationId) {
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
      .select({ workspaceId: tasks.workspaceId })
      .from(tasks)
      .where(and(eq(tasks.id, taskId), eq(tasks.createdByUserId, userId)))
      .limit(1);
    const wsId = taskRow?.workspaceId ?? undefined;
    const taskLifecycle = new TaskLifecycleService(db, userId, wsId);

    await taskLifecycle.onTopicComplete({
      errorMessage,
      lastAssistantContent,
      operationId,
      reason: reason || 'done',
      runTrigger,
      taskId,
      taskIdentifier,
      topicId,
    });

    return c.json({ success: true });
  } catch (error) {
    console.error('[task/on-topic-complete] Error:', error);
    return c.json({ error: error instanceof Error ? error.message : 'Internal error' }, 500);
  }
}

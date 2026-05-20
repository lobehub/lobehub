import debug from 'debug';
import type { Context } from 'hono';

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
    const taskLifecycle = new TaskLifecycleService(db, userId);

    await taskLifecycle.onTopicComplete({
      errorMessage,
      lastAssistantContent,
      operationId,
      reason: reason || 'done',
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

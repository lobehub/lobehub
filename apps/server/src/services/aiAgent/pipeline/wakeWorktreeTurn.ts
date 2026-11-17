import { appEnv } from '@/envs/app';
import { QueueService } from '@/server/services/queue';
import { LocalQueueServiceImpl } from '@/server/services/queue/impls';

/** Fast path. The scheduled-topic scan can also recover a committed send after an enqueue failure. */
export const wakeWorktreeTurn = async (topicId: string, runAt?: string): Promise<void> => {
  const queue = new QueueService();
  const impl = queue.getImpl();
  if (impl instanceof LocalQueueServiceImpl) {
    impl.setExecutionCallback(async () => {
      const { dispatchDueScheduledTopics } =
        await import('@/server/router-hono/workflows/task/handlers/scheduledTopicDispatch');
      await dispatchDueScheduledTopics({ topicId });
    });
  }
  await queue.scheduleMessage({
    deduplicationId: `first-send-worktree:${topicId}:${runAt ?? 'now'}`,
    delay: runAt ? Math.max(1000, new Date(runAt).getTime() - Date.now() + 1000) : undefined,
    endpoint: new URL(
      '/api/workflows/task/scheduled-topic-dispatch',
      appEnv.INTERNAL_APP_URL || appEnv.APP_URL,
    ).toString(),
    operationId: topicId,
    payload: { topicId },
    retries: 3,
    stepIndex: 0,
  });
};

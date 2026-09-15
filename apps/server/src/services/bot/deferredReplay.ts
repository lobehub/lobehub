import { appEnv } from '@/envs/app';
import { QueueService } from '@/server/services/queue';
import { LocalQueueServiceImpl } from '@/server/services/queue/impls';
import type { QueueMessage } from '@/server/services/queue/types';

export interface DeferredReplayTarget {
  applicationId: string;
  messengerInstallationKey?: string;
  platform: string;
  platformThreadId: string;
}

export async function runDeferredReplay(target: DeferredReplayTarget): Promise<void> {
  const { applicationId, messengerInstallationKey, platform, platformThreadId } = target;
  if (messengerInstallationKey) {
    const { getMessengerRouter } = await import('@/server/services/messenger/MessengerRouter');
    await getMessengerRouter().replayDeferredMessages(
      messengerInstallationKey,
      applicationId,
      platformThreadId,
    );
    return;
  }
  const { getBotMessageRouter } = await import('./BotMessageRouter');
  await getBotMessageRouter().replayDeferredMessages(platform, applicationId, platformThreadId);
}

/** Retry only inbound replay; the completed run's reply is never part of this job. */
export async function scheduleDeferredReplay(
  target: DeferredReplayTarget,
  replayId: string,
): Promise<void> {
  const queue = new QueueService();
  const baseURL = process.env.AGENT_RUNTIME_BASE_URL || appEnv.APP_URL || 'http://localhost:3010';
  const message: QueueMessage = {
    deduplicationId: `bot-replay:${target.applicationId}:${target.platformThreadId}:${replayId}`,
    delay: 1000,
    endpoint: new URL('/api/agent/webhooks/bot-replay', baseURL).toString(),
    operationId: replayId,
    payload: target,
    retries: 8,
    retryDelay: '60000',
    stepIndex: 0,
  };
  const impl = queue.getImpl();
  if (impl instanceof LocalQueueServiceImpl) {
    impl.setExecutionCallback(async (_operationId, attempt) => {
      try {
        await runDeferredReplay(target);
      } catch (error) {
        if (attempt >= 8) throw error;
        await queue.scheduleMessage({
          ...message,
          deduplicationId: `${message.deduplicationId}:${attempt + 1}`,
          delay: 60_000,
          stepIndex: attempt + 1,
        });
      }
    });
  }
  await queue.scheduleMessage(message);
}

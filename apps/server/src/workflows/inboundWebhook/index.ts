import { appEnv } from '@/envs/app';

const localTimers = new Map<string, ReturnType<typeof setTimeout>>();

/** One delayed run per webhook. Signals in the DB remain the recovery source of truth. */
export class InboundWebhookWorkflow {
  static async triggerWake(payload: { id: string }, delaySeconds = 10) {
    if (appEnv.enableQueueAgentRuntime) {
      const { qstashClient } = await import('@/libs/qstash');
      return qstashClient.publishJSON({
        body: payload,
        delay: Math.max(0, delaySeconds),
        flowControl: { key: `inbound-webhook.wake.${payload.id}`, parallelism: 1 },
        retries: 3,
        url: new URL(
          '/api/workflows/inbound-webhook/wake',
          appEnv.INTERNAL_APP_URL || appEnv.APP_URL,
        ).toString(),
      });
    }
    if (localTimers.has(payload.id)) return;
    const timer = setTimeout(async () => {
      localTimers.delete(payload.id);
      try {
        const { getServerDB } = await import('@/database/core/db-adaptor');
        const { wakeInboundWebhook } = await import('@/server/services/inboundWebhook/waker');
        const result = await wakeInboundWebhook(await getServerDB(), payload.id);
        if (result.outcome === 'deferred') await InboundWebhookWorkflow.triggerWake(payload, 30);
      } catch (error) {
        console.error('[inboundWebhook:workflow] Local wake failed', error);
      }
    }, delaySeconds * 1000);
    timer.unref?.();
    localTimers.set(payload.id, timer);
  }
}

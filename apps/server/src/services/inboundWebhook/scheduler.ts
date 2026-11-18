import { redisService } from '@/server/services/redis';
import { InboundWebhookWorkflow } from '@/server/workflows/inboundWebhook';

/** Delivery/sweep scheduling stays outside the worker to keep the static graph acyclic. */
export async function scheduleInboundWebhookWake(id: string, delaySeconds = 10): Promise<void> {
  if (!(await redisService.inboundWebhook.claimWakeWindow(id))) return;
  try {
    await InboundWebhookWorkflow.triggerWake({ id }, delaySeconds);
  } catch (error) {
    console.error('[inboundWebhook:schedule] Could not enqueue wake', id, error);
    // Durable pending signals are retried by sweep even while the debounce claim is held.
    throw error;
  }
}

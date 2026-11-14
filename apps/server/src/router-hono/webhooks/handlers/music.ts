import type { Context } from 'hono';

/**
 * Callback target for music providers that require a callback URL on submission and POST
 * progress to it. Completion is decided by the async music router's polling, so the callback
 * only needs a 2xx to stop provider retries.
 */
export const musicWebhook = (c: Context) => c.json({ received: true });

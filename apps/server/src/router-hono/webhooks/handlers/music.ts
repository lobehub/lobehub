import type { Context } from 'hono';

/**
 * Callback target for music gateways. Suno gateways reject a submission without
 * `callBackUrl` and POST progress to it; completion is decided by the async music
 * router's polling, so the callback only needs a 2xx to stop gateway retries.
 */
export const musicWebhook = (c: Context) => c.json({ received: true });

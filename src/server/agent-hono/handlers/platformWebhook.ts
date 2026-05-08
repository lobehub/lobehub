import debug from 'debug';
import type { Context } from 'hono';

import { getBotMessageRouter } from '@/server/services/bot';

const log = debug('lobe-server:bot:webhook-route');

/**
 * Unified webhook endpoint for Chat SDK bot platforms. Handles both:
 *   - POST /api/agent/webhooks/:platform
 *   - POST /api/agent/webhooks/:platform/:appId
 *
 * Hono receives the raw `Request` via `c.req.raw` and forwards it to the
 * platform-specific handler returned by the bot message router (the platform
 * is responsible for verifying its own signature).
 */
export async function platformWebhook(c: Context): Promise<Response> {
  const platform = c.req.param('platform');
  const appId = c.req.param('appId');

  if (!platform) {
    return c.json({ error: 'platform is required' }, 400);
  }

  log('Received webhook: platform=%s, appId=%s, url=%s', platform, appId ?? '(none)', c.req.url);

  const router = getBotMessageRouter();
  const handler = router.getWebhookHandler(platform, appId);
  return handler(c.req.raw);
}

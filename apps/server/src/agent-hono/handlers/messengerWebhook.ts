import debug from 'debug';
import type { Context } from 'hono';

import { getMessengerRouter } from '@/server/services/messenger';

const log = debug('lobe-server:messenger:webhook-route');

/**
 * Webhook endpoint for the shared Messenger bot.
 *
 * Distinct from `/api/agent/webhooks/:platform/:appId` which routes per-user
 * Bot Channels by `applicationId`. Here, the bot is global per platform with
 * credentials in env, and routing is by message sender → linked agent.
 *
 *   - POST /api/agent/messenger/webhooks/telegram
 *   - POST /api/agent/messenger/webhooks/slack   (planned)
 */
export async function messengerWebhook(c: Context): Promise<Response> {
  const platform = c.req.param('platform');

  if (!platform) {
    return c.json({ error: 'platform is required' }, 400);
  }

  log('Received messenger webhook: platform=%s, url=%s', platform, c.req.url);

  const router = getMessengerRouter();
  const handler = router.getWebhookHandler(platform);
  return handler(c.req.raw);
}

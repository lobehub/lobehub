import debug from 'debug';

import { getMessengerRouter } from '@/server/services/messenger';

const log = debug('lobe-server:messenger:webhook-route');

/**
 * Webhook endpoint for the shared Messenger bot.
 *
 * Distinct from `/api/agent/webhooks/[platform]/[appId]` which routes per-user
 * Bot Channels by `applicationId`. Here, the bot is global per platform with
 * credentials in env, and routing is by message sender → linked agent.
 *
 *   - POST /api/agent/messenger/webhooks/telegram
 *   - POST /api/agent/messenger/webhooks/slack   (planned)
 */
export const POST = async (
  req: Request,
  { params }: { params: Promise<{ platform: string }> },
): Promise<Response> => {
  const { platform } = await params;

  log('Received messenger webhook: platform=%s, url=%s', platform, req.url);

  const router = getMessengerRouter();
  const handler = router.getWebhookHandler(platform);
  return handler(req);
};

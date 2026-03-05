import debug from 'debug';

import { getBotMessageRouter } from '@/server/services/bot';

const log = debug('lobe-server:bot:webhook-route');

/**
 * Bot-specific webhook endpoint.
 *
 * Telegram bots register webhooks as `/api/agent/webhooks/telegram/{appId}`
 * so the router can look up the correct Chat SDK bot instance directly
 * without iterating all registered bots.
 *
 * Route: POST /api/agent/webhooks/[platform]/[appId]
 */
export const POST = async (
  req: Request,
  { params }: { params: Promise<{ appId: string; platform: string }> },
): Promise<Response> => {
  const { platform, appId } = await params;

  log('Received webhook: platform=%s, appId=%s, url=%s', platform, appId, req.url);

  const router = getBotMessageRouter();
  const handler = router.getWebhookHandler(platform, appId);
  return handler(req);
};

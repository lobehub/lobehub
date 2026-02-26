import debug from 'debug';

import { getBotMessageRouter } from '@/server/services/bot';

const log = debug('lobe-server:bot:webhook-route');

/**
 * Unified webhook endpoint for Chat SDK bot platforms (Discord, Slack, etc.).
 *
 * Each platform adapter handles its own signature verification and event parsing.
 * The BotMessageRouter routes the request to the correct Chat SDK bot instance.
 *
 * Route: POST /api/agent/webhooks/[platform]
 */
export const POST = async (
  req: Request,
  { params }: { params: Promise<{ platform: string }> },
): Promise<Response> => {
  const { platform } = await params;

  log('Received webhook: platform=%s, url=%s', platform, req.url);

  const router = getBotMessageRouter();
  const handler = router.getWebhookHandler(platform);
  return handler(req);
};

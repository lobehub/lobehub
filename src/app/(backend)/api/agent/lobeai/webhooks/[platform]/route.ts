import debug from 'debug';

import { getLobeAIMessageRouter } from '@/server/services/lobeai';

const log = debug('lobe-server:lobeai:webhook-route');

/**
 * Webhook endpoint for the shared LobeAI bot.
 *
 * Distinct from `/api/agent/webhooks/[platform]/[appId]` which routes per-user
 * Bot Channels by `applicationId`. Here, the bot is global per platform with
 * credentials in env, and routing is by message sender → linked agent.
 *
 *   - POST /api/agent/lobeai/webhooks/telegram
 *   - POST /api/agent/lobeai/webhooks/slack   (planned)
 */
export const POST = async (
  req: Request,
  { params }: { params: Promise<{ platform: string }> },
): Promise<Response> => {
  const { platform } = await params;

  log('Received LobeAI webhook: platform=%s, url=%s', platform, req.url);

  const router = getLobeAIMessageRouter();
  const handler = router.getWebhookHandler(platform);
  return handler(req);
};

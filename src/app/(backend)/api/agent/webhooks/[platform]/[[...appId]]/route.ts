import debug from 'debug';

import { getBotMessageRouter } from '@/server/services/bot';

const log = debug('lobe-server:bot:webhook-route');

/**
 * Unified webhook endpoint for Chat SDK bot platforms.
 *
 * Handles both generic and bot-specific webhook URLs:
 *   - POST /api/agent/webhooks/[platform]
 *   - POST /api/agent/webhooks/[platform]/[appId]
 *
 * Using an optional catch-all `[[...appId]]` ensures both patterns are served
 * by a single serverless function, avoiding deployment issues with nested
 * dynamic segments on Vercel.
 */
export const POST = async (
  req: Request,
  { params }: { params: Promise<{ appId?: string[]; platform: string }> },
): Promise<Response> => {
  const { platform, appId: appIdSegments } = await params;
  const appId = appIdSegments?.[0];

  log('Received webhook: platform=%s, appId=%s, url=%s', platform, appId ?? '(none)', req.url);

  const router = getBotMessageRouter();
  const handler = router.getWebhookHandler(platform, appId);
  return handler(req);
};

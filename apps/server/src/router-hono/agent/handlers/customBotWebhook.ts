import debug from 'debug';
import type { Context } from 'hono';

import { getServerDB } from '@/database/core/db-adaptor';
import { AgentBotProviderModel } from '@/database/models/agentBotProvider';
import { getBotMessageRouter } from '@/server/services/bot';
import { WEBHOOK_PLATFORM_ID } from '@/server/services/bot/platforms/webhook/protocol';
import { after } from '@/server/utils/scheduleAfterResponse';

const log = debug('lobe-server:bot:custom-webhook-route');

const UUID_RE = /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i;

/**
 * The bot a `{botId}` names: the bot's REST id (`/api/v1/bots/{id}`) or its Bot ID (the
 * application id chosen when it was created). `undefined` when the id names a bot on
 * another platform — that bot does not speak this protocol.
 */
const resolveApplicationId = async (botId: string): Promise<string | undefined> => {
  if (!UUID_RE.test(botId)) return botId;

  const [row] = await AgentBotProviderModel.findByIds(await getServerDB(), [botId]);
  if (!row) return botId;
  return row.platform === WEBHOOK_PLATFORM_ID ? row.applicationId : undefined;
};

/**
 * POST /api/agent/webhooks/custom/:botId — inbound messages for a custom webhook bot.
 *
 * Unauthenticated at this layer on purpose: the request is signed with the bot's
 * secret, and the adapter refuses anything whose `X-LobeHub-Signature` does not
 * verify (see `platforms/webhook/protocol-spec.md`).
 */
export async function customBotWebhook(c: Context): Promise<Response> {
  const botId = c.req.param('botId');
  if (!botId) return c.json({ error: 'bot_id_required' }, 400);

  const applicationId = await resolveApplicationId(botId);
  if (!applicationId) return c.json({ error: 'bot_not_found' }, 404);

  log('Received custom webhook: botId=%s, appId=%s', botId, applicationId);

  const handler = getBotMessageRouter().getWebhookHandler(WEBHOOK_PLATFORM_ID, applicationId);
  return handler(c.req.raw, { waitUntil: (task) => after(() => task) });
}

import debug from 'debug';
import type { Context } from 'hono';

import { getServerDB } from '@/database/core/db-adaptor';
import { BotCallbackService } from '@/server/services/bot/BotCallbackService';

const log = debug('lobe-server:agent:bot-callback');

/**
 * Bot callback endpoint for agent step/completion webhooks.
 *
 * In queue mode, AgentRuntimeService fires webhooks (via QStash) after each step
 * and on completion. This endpoint verifies the signature (via the `qstashAuth`
 * middleware on the route) and delegates to BotCallbackService.
 */
export async function botCallback(c: Context): Promise<Response> {
  let body: any;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 400);
  }

  const { type, applicationId, platformThreadId, progressMessageId } = body;

  log(
    'bot-callback: type=%s, applicationId=%s, platformThreadId=%s, progressMessageId=%s',
    type,
    applicationId,
    platformThreadId,
    progressMessageId,
  );

  if (!type || !applicationId || !platformThreadId) {
    return c.json({ error: 'Missing required fields: type, applicationId, platformThreadId' }, 400);
  }

  if (type !== 'step' && type !== 'completion') {
    return c.json({ error: `Unknown callback type: ${type}` }, 400);
  }

  // console (not debug) for completions only: arrival of the final-reply
  // callback must be provable from production logs (LOBE-11632) — the debug
  // namespace above is not enabled in production, and steps are too chatty.
  if (type === 'completion') {
    console.info(
      `[botCallback] completion received (operationId=${body.operationId}, thread=${platformThreadId}, reason=${body.reason}, contentLen=${typeof body.lastAssistantContent === 'string' ? body.lastAssistantContent.length : 0})`,
    );
  }

  try {
    const serverDB = await getServerDB();
    const service = new BotCallbackService(serverDB);
    await service.handleCallback(body);

    return c.json({ success: true });
  } catch (error) {
    console.error('bot-callback error:', error);
    return c.json({ error: error instanceof Error ? error.message : 'Internal error' }, 500);
  }
}

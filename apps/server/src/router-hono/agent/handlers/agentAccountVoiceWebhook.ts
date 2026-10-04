import debug from 'debug';
import type { Context } from 'hono';

import { getServerDB } from '@/database/core/db-adaptor';
import { createDefaultNumberServices } from '@/server/services/agentIdentity/providers';

const log = debug('lobe-server:agent:account-voice-webhook');

/**
 * Inbound calls to a dedicated agent number.
 *
 * `POST /api/agent/accounts/webhooks/:provider/voice`
 *
 * Like the SMS webhook it runs before any auth middleware and trusts nothing
 * but the carrier signature, which the carrier adapter verifies. The answer is
 * synchronous call-control markup (TwiML): a live number takes a transcribed
 * voicemail — the transcript is posted back to the SMS webhook and lands in the
 * agent's inbox like a text — and a quarantined number says it is out of
 * service. 404 when the provider has no synchronous voice answer.
 */
export async function agentAccountVoiceWebhook(c: Context): Promise<Response> {
  const provider = c.req.param('provider');
  const body = await c.req.text();
  const headers: Record<string, string | undefined> = {};
  c.req.raw.headers.forEach((value, key) => {
    headers[key] = value;
  });

  try {
    const db = await getServerDB();
    const service = createDefaultNumberServices(db).find((item) => item.carrier.name === provider);
    const answer = await service?.answerVoiceCall({ body, headers });
    if (!answer) return c.json({ error: 'voice is not configured for this provider' }, 404);

    log('voice call: provider=%s mode=%s', provider, answer.mode);
    return c.body(answer.body, answer.status as 200 | 401, {
      'Content-Type': answer.contentType,
      'X-Lobehub-Outcome': answer.mode,
    });
  } catch (error) {
    log('voice webhook failed for provider %s: %O', provider, error);
    return c.json({ error: 'voice webhook processing failed' }, 500);
  }
}

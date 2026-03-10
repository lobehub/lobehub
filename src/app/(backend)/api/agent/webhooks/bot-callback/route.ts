import debug from 'debug';
import { NextResponse } from 'next/server';

import { getServerDB } from '@/database/core/db-adaptor';
import { verifyQStashSignature } from '@/libs/qstash';
import { BotCallbackService } from '@/server/services/bot/BotCallbackService';

const log = debug('api-route:agent:bot-callback');

/**
 * Bot callback endpoint for agent step/completion webhooks.
 *
 * In queue mode, AgentRuntimeService fires webhooks (via QStash) after each step
 * and on completion. This endpoint verifies the signature and delegates to BotCallbackService.
 *
 * Route: POST /api/agent/webhooks/bot-callback
 */
export async function POST(request: Request): Promise<Response> {
  const rawBody = await request.text();

  const isValid = await verifyQStashSignature(request, rawBody);
  if (!isValid) {
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
  }

  const body = JSON.parse(rawBody);

  const { type, applicationId, platformThreadId, progressMessageId } = body;

  log(
    'bot-callback: type=%s, applicationId=%s, platformThreadId=%s, progressMessageId=%s',
    type,
    applicationId,
    platformThreadId,
    progressMessageId,
  );

  if (!type || !applicationId || !platformThreadId || !progressMessageId) {
    return NextResponse.json(
      {
        error: 'Missing required fields: type, applicationId, platformThreadId, progressMessageId',
      },
      { status: 400 },
    );
  }

  if (type !== 'step' && type !== 'completion') {
    return NextResponse.json({ error: `Unknown callback type: ${type}` }, { status: 400 });
  }

  try {
    const serverDB = await getServerDB();
    const service = new BotCallbackService(serverDB);
    await service.handleCallback(body);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('bot-callback error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal error' },
      { status: 500 },
    );
  }
}

import debug from 'debug';
import { type NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { gatewayEnv } from '@/envs/gateway';
import {
  BOT_RUNTIME_STATUSES,
  type BotRuntimeStatus,
  updateBotRuntimeStatus,
} from '@/server/services/gateway/runtimeStatus';

const log = debug('api-route:agent:gateway:callback');

const StateChangeSchema = z.object({
  applicationId: z.string().optional(),
  connectionId: z.string(),
  platform: z.string(),
  state: z.object({
    error: z.string().optional(),
    status: z.enum(['connected', 'connecting', 'disconnected', 'dormant', 'error']),
  }),
});

/**
 * Receive connection state-change callbacks from the external message gateway.
 * When a persistent connection (e.g. Discord WebSocket) transitions to
 * "connected" or "error" asynchronously, the gateway POSTs here so LobeHub
 * can update the bot runtime status visible to users.
 *
 * Authenticated with MESSAGE_GATEWAY_SERVICE_TOKEN.
 */
export async function POST(request: NextRequest) {
  // Ignore callbacks when gateway is disabled — connections are managed locally,
  // and stale gateway callbacks (e.g. from disconnectAll during migration) could
  // overwrite locally-managed status.
  if (gatewayEnv.MESSAGE_GATEWAY_ENABLED !== '1') {
    return new NextResponse(null, { status: 204 });
  }

  const serviceToken = gatewayEnv.MESSAGE_GATEWAY_SERVICE_TOKEN;
  if (!serviceToken) {
    return NextResponse.json({ error: 'Service not configured' }, { status: 503 });
  }

  const authHeader = request.headers.get('authorization');
  if (authHeader !== `Bearer ${serviceToken}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let parsed;
  try {
    const body = await request.json();
    parsed = StateChangeSchema.safeParse(body);
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid body', issues: parsed.error.issues },
      { status: 400 },
    );
  }

  const { applicationId, platform, state } = parsed.data;

  if (!applicationId) {
    return new NextResponse(null, { status: 204 });
  }

  const statusMap: Partial<Record<string, BotRuntimeStatus>> = {
    connected: BOT_RUNTIME_STATUSES.connected,
    disconnected: BOT_RUNTIME_STATUSES.disconnected,
    dormant: BOT_RUNTIME_STATUSES.dormant,
    error: BOT_RUNTIME_STATUSES.failed,
  };

  const runtimeStatus = statusMap[state.status];
  if (!runtimeStatus) {
    // "connecting" — no status update needed
    return new NextResponse(null, { status: 204 });
  }

  await updateBotRuntimeStatus({
    applicationId,
    errorMessage: state.error,
    platform,
    status: runtimeStatus,
  });

  log('Updated %s:%s → %s', platform, applicationId, runtimeStatus);

  return new NextResponse(null, { status: 204 });
}

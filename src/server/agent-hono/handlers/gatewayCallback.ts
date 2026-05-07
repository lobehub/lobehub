import debug from 'debug';
import type { Context } from 'hono';
import { z } from 'zod';

import { gatewayEnv } from '@/envs/gateway';
import {
  BOT_RUNTIME_STATUSES,
  type BotRuntimeStatus,
  updateBotRuntimeStatus,
} from '@/server/services/gateway/runtimeStatus';

const log = debug('lobe-server:agent:gateway-callback');

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
 * Authenticated with `MESSAGE_GATEWAY_SERVICE_TOKEN`.
 *
 * Auth is inline (not a route-level middleware) because the disabled-feature
 * 204 short-circuit must run *before* the auth check — when the gateway is
 * off we silently no-op rather than 401 stale callers.
 */
export async function gatewayCallback(c: Context): Promise<Response> {
  // Ignore callbacks when gateway is disabled — connections are managed locally,
  // and stale gateway callbacks (e.g. from disconnectAll during migration) could
  // overwrite locally-managed status.
  if (gatewayEnv.MESSAGE_GATEWAY_ENABLED !== '1') {
    return c.body(null, 204);
  }

  const serviceToken = gatewayEnv.MESSAGE_GATEWAY_SERVICE_TOKEN;
  if (!serviceToken) {
    return c.json({ error: 'Service not configured' }, 503);
  }

  const authHeader = c.req.header('authorization');
  if (authHeader !== `Bearer ${serviceToken}`) {
    return c.json({ error: 'Unauthorized' }, 401);
  }

  let parsed;
  try {
    const body = await c.req.json();
    parsed = StateChangeSchema.safeParse(body);
  } catch {
    return c.json({ error: 'Invalid JSON' }, 400);
  }

  if (!parsed.success) {
    return c.json({ error: 'Invalid body', issues: parsed.error.issues }, 400);
  }

  const { applicationId, platform, state } = parsed.data;

  if (!applicationId) {
    return c.body(null, 204);
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
    return c.body(null, 204);
  }

  await updateBotRuntimeStatus({
    applicationId,
    errorMessage: state.error,
    platform,
    status: runtimeStatus,
  });

  log('Updated %s:%s → %s', platform, applicationId, runtimeStatus);

  return c.body(null, 204);
}

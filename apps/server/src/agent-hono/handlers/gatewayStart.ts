import type { Context } from 'hono';

import { GatewayService } from '@/server/services/gateway';

/**
 * Non-Vercel `ensureRunning` entry point — used by the standalone server
 * launcher (`scripts/serverLauncher/startServer.js`). Body: `{ restart?: boolean }`.
 *
 * Auth: `bearerSecretAuth(KEY_VAULTS_SECRET)` on the route.
 */
export async function gatewayStart(c: Context): Promise<Response> {
  const body = await c.req.json().catch(() => ({}) as Record<string, unknown>);
  const service = new GatewayService();

  try {
    if ((body as { restart?: boolean }).restart) {
      console.info('[GatewayService] Restarting...');
      await service.stop();
    }

    await service.ensureRunning();
    console.info('[GatewayService] Started successfully');

    return c.json({ status: (body as { restart?: boolean }).restart ? 'restarted' : 'started' });
  } catch (error) {
    console.error('[GatewayService] Failed to start:', error);
    return c.json({ error: 'Failed to start gateway' }, 500);
  }
}

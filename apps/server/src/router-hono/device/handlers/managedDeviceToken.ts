import type { Context } from 'hono';
import { z } from 'zod';

import { exchangeManagedDeviceToken, managedDeviceProvider } from '@/business/server/managedDevice';

const requestSchema = z.object({
  // Same bound as `devices.device_id`.
  deviceId: z.string().trim().min(1).max(64),
  secret: z.string().min(1).max(1024),
});

export const NO_STORE = { 'Cache-Control': 'no-store' };

/**
 * POST /api/device/managed/token — a managed cloud device trades its device id
 * and secret for a short-lived device-gateway token.
 *
 * Body `{ deviceId, secret }` → 200 `{ token, expiresAt }`; 400 on a malformed
 * body; 401 when the credentials do not match; 404 when this deployment does
 * not offer managed devices.
 */
export async function managedDeviceToken(c: Context): Promise<Response> {
  if (!(await managedDeviceProvider.isAvailable())) {
    return c.json({ error: 'Not found' }, 404, NO_STORE);
  }

  const body = await c.req.json().catch(() => undefined);
  const parsed = requestSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: 'Invalid request body' }, 400, NO_STORE);
  }

  try {
    const result = await exchangeManagedDeviceToken(parsed.data);

    switch (result.status) {
      case 'issued': {
        return c.json({ expiresAt: result.expiresAt, token: result.token }, 200, NO_STORE);
      }
      case 'invalid-credentials': {
        return c.json({ error: 'Invalid device credentials' }, 401, NO_STORE);
      }
      case 'unavailable': {
        return c.json({ error: 'Not found' }, 404, NO_STORE);
      }
    }
  } catch (error) {
    console.error('[managedDeviceToken] Failed to exchange managed device token:', error);
    return c.json({ error: 'Failed to issue token' }, 500, NO_STORE);
  }
}

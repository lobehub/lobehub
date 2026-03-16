import { Hono } from 'hono';

import { DeviceGatewayDO } from './DeviceGatewayDO';
import type { Env } from './types';

export { DeviceGatewayDO };

const app = new Hono<{ Bindings: Env }>();

// ─── Health check ───
app.get('/health', (c) => c.text('OK'));

// ─── Auth middleware for service APIs ───
const serviceAuth = (): ((c: any, next: () => Promise<void>) => Promise<Response | void>) => {
  return async (c, next) => {
    const authHeader = c.req.header('Authorization');
    if (authHeader !== `Bearer ${c.env.SERVICE_TOKEN}`) {
      return c.text('Unauthorized', 401);
    }
    await next();
  };
};

// ─── Desktop WebSocket connection ───
app.get('/ws', async (c) => {
  const userId = c.req.query('userId');
  if (!userId) return c.text('Missing userId', 400);

  const id = c.env.DEVICE_GATEWAY.idFromName(`user:${userId}`);
  const stub = c.env.DEVICE_GATEWAY.get(id);

  const headers = new Headers(c.req.raw.headers);
  headers.set('X-User-Id', userId);
  return stub.fetch(new Request(c.req.raw, { headers }));
});

// ─── Vercel Agent HTTP API ───
app.all('/api/device/*', serviceAuth(), async (c) => {
  const body = (await c.req.raw.clone().json()) as { userId: string };
  if (!body.userId) return c.text('Missing userId', 400);

  const id = c.env.DEVICE_GATEWAY.idFromName(`user:${body.userId}`);
  const stub = c.env.DEVICE_GATEWAY.get(id);
  return stub.fetch(c.req.raw);
});

export default app;

import { verifyDesktopToken } from './auth';
import { DeviceGatewayDO } from './DeviceGatewayDO';
import type { Env } from './types';

export { DeviceGatewayDO };

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    // ─── Health check ───
    if (url.pathname === '/health') {
      return new Response('OK', { status: 200 });
    }

    // ─── Desktop WebSocket connection ───
    if (url.pathname === '/ws') {
      const token = url.searchParams.get('token');
      if (!token) return new Response('Missing token', { status: 401 });

      try {
        const { userId } = await verifyDesktopToken(env, token);

        const id = env.DEVICE_GATEWAY.idFromName(`user:${userId}`);
        const stub = env.DEVICE_GATEWAY.get(id);

        // Forward WebSocket upgrade to DO
        const headers = new Headers(request.headers);
        headers.set('X-User-Id', userId);
        return stub.fetch(new Request(request, { headers }));
      } catch {
        return new Response('Invalid token', { status: 401 });
      }
    }

    // ─── Vercel Agent HTTP API ───
    if (url.pathname.startsWith('/api/device/')) {
      const authHeader = request.headers.get('Authorization');
      if (authHeader !== `Bearer ${env.SERVICE_TOKEN}`) {
        return new Response('Unauthorized', { status: 401 });
      }

      const body = (await request.clone().json()) as { userId: string };
      const id = env.DEVICE_GATEWAY.idFromName(`user:${body.userId}`);
      const stub = env.DEVICE_GATEWAY.get(id);
      return stub.fetch(request);
    }

    return new Response('Not Found', { status: 404 });
  },
};

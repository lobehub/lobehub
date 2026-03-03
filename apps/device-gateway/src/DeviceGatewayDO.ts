import { DurableObject } from 'cloudflare:workers';

import type { DeviceAttachment, Env } from './types';

export class DeviceGatewayDO extends DurableObject<Env> {
  private pendingRequests = new Map<
    string,
    {
      resolve: (result: any) => void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    // ─── WebSocket upgrade (from Desktop) ───
    if (request.headers.get('Upgrade') === 'websocket') {
      const pair = new WebSocketPair();
      const [client, server] = Object.values(pair);

      this.ctx.acceptWebSocket(server);

      const deviceId = url.searchParams.get('deviceId') || 'unknown';
      const hostname = url.searchParams.get('hostname') || '';
      const platform = url.searchParams.get('platform') || '';

      server.serializeAttachment({
        connectedAt: Date.now(),
        deviceId,
        hostname,
        platform,
      } satisfies DeviceAttachment);

      return new Response(null, { status: 101, webSocket: client });
    }

    // ─── HTTP API (from Vercel Agent) ───
    if (url.pathname === '/api/device/status') {
      const sockets = this.ctx.getWebSockets();
      return Response.json({
        deviceCount: sockets.length,
        online: sockets.length > 0,
      });
    }

    if (url.pathname === '/api/device/tool-call') {
      return this.handleToolCall(request);
    }

    if (url.pathname === '/api/device/devices') {
      const sockets = this.ctx.getWebSockets();
      const devices = sockets.map((ws) => ws.deserializeAttachment() as DeviceAttachment);
      return Response.json({ devices });
    }

    return new Response('Not Found', { status: 404 });
  }

  // ─── Hibernation Handlers ───

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer) {
    const data = JSON.parse(message as string);

    if (data.type === 'tool_call_response') {
      const pending = this.pendingRequests.get(data.requestId);
      if (pending) {
        clearTimeout(pending.timer);
        pending.resolve(data.result);
        this.pendingRequests.delete(data.requestId);
      }
    }

    if (data.type === 'heartbeat') {
      ws.send(JSON.stringify({ type: 'heartbeat_ack' }));
    }
  }

  async webSocketClose(_ws: WebSocket, _code: number) {
    // Hibernation API handles connection cleanup automatically
  }

  async webSocketError(ws: WebSocket, _error: unknown) {
    ws.close(1011, 'Internal error');
  }

  // ─── Tool Call RPC ───

  private async handleToolCall(request: Request): Promise<Response> {
    const sockets = this.ctx.getWebSockets();
    if (sockets.length === 0) {
      return Response.json(
        { content: '桌面设备不在线', error: 'DEVICE_OFFLINE', success: false },
        { status: 503 },
      );
    }

    const {
      deviceId,
      timeout = 30_000,
      toolCall,
    } = (await request.json()) as {
      deviceId?: string;
      timeout?: number;
      toolCall: unknown;
    };
    const requestId = crypto.randomUUID();

    // Select target device (specified > first available)
    const targetWs = deviceId
      ? sockets.find((ws) => {
          const att = ws.deserializeAttachment() as DeviceAttachment;
          return att.deviceId === deviceId;
        })
      : sockets[0];

    if (!targetWs) {
      return Response.json({ error: 'DEVICE_NOT_FOUND', success: false }, { status: 503 });
    }

    try {
      const result = await new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          this.pendingRequests.delete(requestId);
          reject(new Error('TIMEOUT'));
        }, timeout);

        this.pendingRequests.set(requestId, { resolve, timer });

        targetWs.send(
          JSON.stringify({
            requestId,
            toolCall,
            type: 'tool_call_request',
          }),
        );
      });

      return Response.json({ success: true, ...(result as object) });
    } catch (err) {
      return Response.json(
        {
          content: `工具调用超时（${timeout / 1000}s）`,
          error: (err as Error).message,
          success: false,
        },
        { status: 504 },
      );
    }
  }
}

import { DurableObject } from 'cloudflare:workers';
import { Hono } from 'hono';

import { resolveSocketAuth, verifyApiKeyToken, verifyDesktopToken } from './auth';
import type { DeviceAttachment, Env } from './types';

const AUTH_TIMEOUT = 10_000; // 10s to authenticate after connect
const HEARTBEAT_TIMEOUT = 90_000; // 90s without heartbeat → close
const HEARTBEAT_CHECK_INTERVAL = 90_000; // check every 90s

export class DeviceGatewayDO extends DurableObject<Env> {
  private pendingRequests = new Map<
    string,
    {
      resolve: (result: any) => void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();

  private router = new Hono()
    .all('/api/device/status', async () => {
      const sockets = this.getAuthenticatedSockets();
      return Response.json({
        deviceCount: sockets.length,
        online: sockets.length > 0,
      });
    })
    .post('/api/device/tool-call', async (c) => {
      return this.handleToolCall(c.req.raw);
    })
    .post('/api/device/system-info', async (c) => {
      return this.handleSystemInfo(c.req.raw);
    })
    .all('/api/device/devices', async () => {
      const sockets = this.getAuthenticatedSockets();
      const devices = sockets.map((ws) => ws.deserializeAttachment() as DeviceAttachment);
      return Response.json({ devices });
    });

  async fetch(request: Request): Promise<Response> {
    // ─── WebSocket upgrade (from Desktop) ───
    if (request.headers.get('Upgrade') === 'websocket') {
      return this.handleWebSocketUpgrade(request);
    }

    // ─── HTTP API routes ───
    return this.router.fetch(request);
  }

  // ─── Hibernation Handlers ───

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer) {
    const data = JSON.parse(message as string);
    const att = ws.deserializeAttachment() as DeviceAttachment;

    // ─── Auth message handling ───
    if (data.type === 'auth') {
      if (att.authenticated) return; // Already authenticated, ignore

      try {
        const token = data.token as string | undefined;
        const tokenType = data.tokenType as 'apiKey' | 'jwt' | 'serviceToken' | undefined;
        const serverUrl = data.serverUrl as string | undefined;
        const storedUserId = await this.ctx.storage.get<string>('_userId');

        const verifiedUserId = await resolveSocketAuth({
          serverUrl,
          serviceToken: this.env.SERVICE_TOKEN,
          storedUserId,
          token,
          tokenType,
          verifyApiKey: verifyApiKeyToken,
          verifyJwt: async (jwt) => {
            const result = await verifyDesktopToken(this.env, jwt);
            return { userId: result.userId };
          },
        });

        // Verify userId matches the DO routing
        if (storedUserId && verifiedUserId !== storedUserId) {
          throw new Error('userId mismatch');
        }

        // Mark as authenticated
        att.authenticated = true;
        att.authDeadline = undefined;
        ws.serializeAttachment(att);

        ws.send(JSON.stringify({ type: 'auth_success' }));

        // Schedule heartbeat check for authenticated connections
        await this.scheduleHeartbeatCheck();
      } catch (err) {
        const reason = err instanceof Error ? err.message : 'Authentication failed';
        ws.send(JSON.stringify({ reason, type: 'auth_failed' }));
        ws.close(1008, reason);
      }
      return;
    }

    // ─── Reject unauthenticated messages ───
    if (!att.authenticated) return;

    // ─── Business messages (authenticated only) ───
    if (data.type === 'tool_call_response' || data.type === 'system_info_response') {
      const pending = this.pendingRequests.get(data.requestId);
      if (pending) {
        clearTimeout(pending.timer);
        pending.resolve(data.result);
        this.pendingRequests.delete(data.requestId);
      }
    }

    if (data.type === 'heartbeat') {
      att.lastHeartbeat = Date.now();
      ws.serializeAttachment(att);
      ws.send(JSON.stringify({ type: 'heartbeat_ack' }));
    }
  }

  async webSocketClose(_ws: WebSocket, _code: number) {
    // Hibernation API handles connection cleanup automatically
  }

  async webSocketError(ws: WebSocket, _error: unknown) {
    ws.close(1011, 'Internal error');
  }

  // ─── Heartbeat Timeout ───

  async alarm() {
    const now = Date.now();
    const closedSockets = new Set<WebSocket>();

    for (const ws of this.ctx.getWebSockets()) {
      const att = ws.deserializeAttachment() as DeviceAttachment;

      // Auth timeout: close unauthenticated connections past deadline
      if (!att.authenticated && att.authDeadline && now > att.authDeadline) {
        ws.send(JSON.stringify({ reason: 'Authentication timeout', type: 'auth_failed' }));
        ws.close(1008, 'Authentication timeout');
        closedSockets.add(ws);
        continue;
      }

      // Heartbeat timeout: only for authenticated connections
      if (att.authenticated && now - att.lastHeartbeat > HEARTBEAT_TIMEOUT) {
        ws.close(1000, 'Heartbeat timeout');
        closedSockets.add(ws);
      }
    }

    // Keep alarm running while there are active connections
    const remaining = this.ctx.getWebSockets().filter((ws) => !closedSockets.has(ws));
    if (remaining.length > 0) {
      await this.scheduleHeartbeatCheck();
    }
  }

  // ─── WebSocket Upgrade ───

  private async handleWebSocketUpgrade(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const userId = request.headers.get('X-User-Id');

    const deviceId = url.searchParams.get('deviceId') || 'unknown';
    const hostname = url.searchParams.get('hostname') || '';
    const platform = url.searchParams.get('platform') || '';

    // Close stale connection from the same device
    for (const ws of this.ctx.getWebSockets()) {
      const att = ws.deserializeAttachment() as DeviceAttachment;
      if (att.deviceId === deviceId) {
        ws.close(1000, 'Replaced by new connection');
      }
    }

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);

    this.ctx.acceptWebSocket(server);

    const now = Date.now();
    server.serializeAttachment({
      authDeadline: now + AUTH_TIMEOUT,
      authenticated: false,
      connectedAt: now,
      deviceId,
      hostname,
      lastHeartbeat: now,
      platform,
    } satisfies DeviceAttachment);

    if (userId) {
      await this.ctx.storage.put('_userId', userId);
    }

    // Schedule auth timeout check (10s)
    await this.scheduleAuthTimeout();

    return new Response(null, { status: 101, webSocket: client });
  }

  private async scheduleAuthTimeout() {
    const currentAlarm = await this.ctx.storage.getAlarm();
    if (!currentAlarm) {
      await this.ctx.storage.setAlarm(Date.now() + AUTH_TIMEOUT);
    }
  }

  private async scheduleHeartbeatCheck() {
    const currentAlarm = await this.ctx.storage.getAlarm();
    if (!currentAlarm) {
      await this.ctx.storage.setAlarm(Date.now() + HEARTBEAT_CHECK_INTERVAL);
    }
  }

  // ─── Helpers ───

  private getAuthenticatedSockets(): WebSocket[] {
    return this.ctx.getWebSockets().filter((ws) => {
      const att = ws.deserializeAttachment() as DeviceAttachment;
      return att.authenticated;
    });
  }

  // ─── System Info RPC ───

  private async handleSystemInfo(request: Request): Promise<Response> {
    const sockets = this.getAuthenticatedSockets();
    if (sockets.length === 0) {
      return Response.json({ error: 'DEVICE_OFFLINE', success: false }, { status: 503 });
    }

    const { deviceId, timeout = 10_000 } = (await request.json()) as {
      deviceId?: string;
      timeout?: number;
    };
    const requestId = crypto.randomUUID();

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
            type: 'system_info_request',
          }),
        );
      });

      return Response.json({ success: true, ...(result as object) });
    } catch (err) {
      return Response.json(
        {
          error: (err as Error).message,
          success: false,
        },
        { status: 504 },
      );
    }
  }

  // ─── Tool Call RPC ───

  private async handleToolCall(request: Request): Promise<Response> {
    const sockets = this.getAuthenticatedSockets();
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

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { QQGatewayOptions } from './gateway';
import { QQGatewayConnection } from './gateway';
import { QQ_WS_OP_CODES } from './types';

// ---- Mock WebSocket ----

class MockWebSocket {
  static OPEN = 1;
  static CLOSED = 3;
  static instances: MockWebSocket[] = [];

  readyState = MockWebSocket.OPEN;
  url: string;
  private listeners: Map<string, Array<(...args: any[]) => void>> = new Map();
  sentMessages: string[] = [];

  constructor(url: string) {
    this.url = url;
    MockWebSocket.instances.push(this);
    // Simulate async open
    setTimeout(() => this.emit('open', {}), 0);
  }

  addEventListener(event: string, fn: (...args: any[]) => void) {
    const list = this.listeners.get(event) || [];
    list.push(fn);
    this.listeners.set(event, list);
  }

  removeEventListener(event: string, fn: (...args: any[]) => void) {
    const list = this.listeners.get(event) || [];
    this.listeners.set(
      event,
      list.filter((f) => f !== fn),
    );
  }

  send(data: string) {
    this.sentMessages.push(data);
  }

  close(code?: number, reason?: string) {
    this.readyState = MockWebSocket.CLOSED;
    this.emit('close', { code: code ?? 1000, reason: reason ?? '' });
  }

  // Test helpers
  emit(event: string, data: any) {
    const list = this.listeners.get(event) || [];
    for (const fn of list) fn(data);
  }

  simulateMessage(payload: Record<string, any>) {
    this.emit('message', { data: JSON.stringify(payload) });
  }

  getLastSentPayload(): Record<string, any> | undefined {
    const last = this.sentMessages.at(-1);
    return last ? JSON.parse(last) : undefined;
  }
}

// ---- Mock API Client ----

function createMockApi() {
  return {
    getAccessToken: vi.fn().mockResolvedValue('mock_access_token'),
    getGatewayUrl: vi.fn().mockResolvedValue({ url: 'wss://mock-gateway.qq.com/websocket/' }),
  } as any;
}

// ---- Tests ----

describe('QQGatewayConnection', () => {
  beforeEach(() => {
    MockWebSocket.instances = [];
    vi.stubGlobal('WebSocket', MockWebSocket);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('ok', { status: 200 })));
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  function createConnection(overrides?: Partial<QQGatewayOptions>) {
    const api = createMockApi();
    const options: QQGatewayOptions = {
      log: vi.fn(),
      webhookUrl: 'http://localhost:3000/api/agent/webhooks/qq/test_app',
      ...overrides,
    };
    const conn = new QQGatewayConnection(api, options);
    return { api, conn, options };
  }

  async function connectAndGetWs(overrides?: Partial<QQGatewayOptions>) {
    const result = createConnection(overrides);
    const connectPromise = result.conn.connect();

    // Let the WebSocket open
    await vi.advanceTimersByTimeAsync(10);

    const ws = MockWebSocket.instances[0];
    return { ...result, connectPromise, ws };
  }

  describe('connect', () => {
    it('should fetch gateway URL and open WebSocket', async () => {
      const { api, connectPromise, ws } = await connectAndGetWs();

      expect(api.getGatewayUrl).toHaveBeenCalled();
      expect(ws.url).toBe('wss://mock-gateway.qq.com/websocket/');

      // Simulate Hello → Identify → Ready
      ws.simulateMessage({ op: QQ_WS_OP_CODES.HELLO, d: { heartbeat_interval: 45000 } });
      await vi.advanceTimersByTimeAsync(10);

      ws.simulateMessage({
        d: {
          session_id: 'sess_1',
          shard: [0, 1],
          user: { bot: true, id: 'bot_1', username: 'TestBot' },
          version: 1,
        },
        op: QQ_WS_OP_CODES.DISPATCH,
        s: 1,
        t: 'READY',
      });

      await connectPromise;
    });

    it('should send Identify after receiving Hello', async () => {
      const { connectPromise, ws } = await connectAndGetWs();

      ws.simulateMessage({ op: QQ_WS_OP_CODES.HELLO, d: { heartbeat_interval: 45000 } });
      await vi.advanceTimersByTimeAsync(10);

      const identifyPayload = ws.getLastSentPayload();
      expect(identifyPayload?.op).toBe(QQ_WS_OP_CODES.IDENTIFY);
      expect(identifyPayload?.d.token).toBe('QQBot mock_access_token');
      expect(identifyPayload?.d.intents).toBeTypeOf('number');
      expect(identifyPayload?.d.shard).toEqual([0, 1]);

      // Complete the connection
      ws.simulateMessage({
        d: {
          session_id: 'sess_1',
          shard: [0, 1],
          user: { bot: true, id: 'bot_1', username: 'TestBot' },
          version: 1,
        },
        op: QQ_WS_OP_CODES.DISPATCH,
        s: 1,
        t: 'READY',
      });
      await connectPromise;
    });

    it('should resolve when abortSignal is already aborted', async () => {
      const abort = new AbortController();
      abort.abort();
      const { conn } = createConnection({ abortSignal: abort.signal });
      await conn.connect(); // Should resolve immediately
    });

    it('should reject when identify fails before READY', async () => {
      const { api, connectPromise, ws } = await connectAndGetWs();
      vi.mocked(api.getAccessToken).mockRejectedValueOnce(new Error('bad token'));
      const rejection = expect(connectPromise).rejects.toThrow('bad token');

      ws.simulateMessage({ op: QQ_WS_OP_CODES.HELLO, d: { heartbeat_interval: 45000 } });
      await vi.advanceTimersByTimeAsync(10);

      await rejection;
    });
  });

  describe('heartbeat', () => {
    it('should send heartbeat after jittered interval', async () => {
      const { connectPromise, ws } = await connectAndGetWs();

      ws.simulateMessage({ op: QQ_WS_OP_CODES.HELLO, d: { heartbeat_interval: 45000 } });
      await vi.advanceTimersByTimeAsync(10);

      // Complete READY
      ws.simulateMessage({
        d: {
          session_id: 'sess_1',
          shard: [0, 1],
          user: { bot: true, id: 'bot_1', username: 'TestBot' },
          version: 1,
        },
        op: QQ_WS_OP_CODES.DISPATCH,
        s: 1,
        t: 'READY',
      });
      await connectPromise;

      // Advance past jitter + interval to trigger heartbeat
      await vi.advanceTimersByTimeAsync(50000);

      const heartbeats = ws.sentMessages
        .map((m) => JSON.parse(m))
        .filter((p) => p.op === QQ_WS_OP_CODES.HEARTBEAT);

      expect(heartbeats.length).toBeGreaterThanOrEqual(1);
      expect(heartbeats[0].d).toBe(1); // seq from READY
    });

    it('should handle heartbeat ACK', async () => {
      const { connectPromise, ws } = await connectAndGetWs();

      ws.simulateMessage({ op: QQ_WS_OP_CODES.HELLO, d: { heartbeat_interval: 45000 } });
      await vi.advanceTimersByTimeAsync(10);

      ws.simulateMessage({
        d: {
          session_id: 'sess_1',
          shard: [0, 1],
          user: { bot: true, id: 'bot_1', username: 'TestBot' },
          version: 1,
        },
        op: QQ_WS_OP_CODES.DISPATCH,
        s: 1,
        t: 'READY',
      });
      await connectPromise;

      // Send heartbeat ACK
      ws.simulateMessage({ op: QQ_WS_OP_CODES.HEARTBEAT_ACK });
      // Should not crash — just marks ACK as received
    });
  });

  describe('dispatch event forwarding', () => {
    it('should forward message events to webhook URL', async () => {
      const { connectPromise, ws } = await connectAndGetWs();

      ws.simulateMessage({ op: QQ_WS_OP_CODES.HELLO, d: { heartbeat_interval: 45000 } });
      await vi.advanceTimersByTimeAsync(10);

      ws.simulateMessage({
        d: {
          session_id: 'sess_1',
          shard: [0, 1],
          user: { bot: true, id: 'bot_1', username: 'TestBot' },
          version: 1,
        },
        op: QQ_WS_OP_CODES.DISPATCH,
        s: 1,
        t: 'READY',
      });
      await connectPromise;

      // Simulate a message event
      ws.simulateMessage({
        d: {
          author: { id: 'user_1' },
          content: 'hello',
          group_openid: 'group_1',
          id: 'msg_1',
          timestamp: '2024-01-01T00:00:00Z',
        },
        op: QQ_WS_OP_CODES.DISPATCH,
        s: 2,
        t: 'GROUP_AT_MESSAGE_CREATE',
      });

      await vi.advanceTimersByTimeAsync(10);

      expect(fetch).toHaveBeenCalledWith(
        'http://localhost:3000/api/agent/webhooks/qq/test_app',
        expect.objectContaining({
          body: expect.any(String),
          headers: { 'Content-Type': 'application/json' },
          method: 'POST',
        }),
      );

      const fetchCall = vi.mocked(fetch).mock.calls[0];
      const body = JSON.parse(fetchCall[1]!.body as string);
      expect(body.op).toBe(0);
      expect(body.t).toBe('GROUP_AT_MESSAGE_CREATE');
      expect(body.d.content).toBe('hello');
    });
  });

  describe('reconnection', () => {
    it('should handle server reconnect request (OP 7)', async () => {
      const { connectPromise, ws } = await connectAndGetWs();

      ws.simulateMessage({ op: QQ_WS_OP_CODES.HELLO, d: { heartbeat_interval: 45000 } });
      await vi.advanceTimersByTimeAsync(10);

      ws.simulateMessage({
        d: {
          session_id: 'sess_1',
          shard: [0, 1],
          user: { bot: true, id: 'bot_1', username: 'TestBot' },
          version: 1,
        },
        op: QQ_WS_OP_CODES.DISPATCH,
        s: 1,
        t: 'READY',
      });
      await connectPromise;

      // Server requests reconnect
      ws.simulateMessage({ op: QQ_WS_OP_CODES.RECONNECT });

      // WebSocket should be closed
      expect(ws.readyState).toBe(MockWebSocket.CLOSED);
    });

    it('should handle invalid session (OP 9) with canResume=false', async () => {
      const { connectPromise, ws } = await connectAndGetWs();

      ws.simulateMessage({ op: QQ_WS_OP_CODES.HELLO, d: { heartbeat_interval: 45000 } });
      await vi.advanceTimersByTimeAsync(10);

      ws.simulateMessage({
        d: {
          session_id: 'sess_1',
          shard: [0, 1],
          user: { bot: true, id: 'bot_1', username: 'TestBot' },
          version: 1,
        },
        op: QQ_WS_OP_CODES.DISPATCH,
        s: 1,
        t: 'READY',
      });
      await connectPromise;

      // Invalid session, cannot resume
      ws.simulateMessage({ d: false, op: QQ_WS_OP_CODES.INVALID_SESSION });
      expect(ws.readyState).toBe(MockWebSocket.CLOSED);
    });

    it('should reconnect after a post-READY close', async () => {
      const { connectPromise, ws } = await connectAndGetWs();

      ws.simulateMessage({ op: QQ_WS_OP_CODES.HELLO, d: { heartbeat_interval: 45000 } });
      await vi.advanceTimersByTimeAsync(10);

      ws.simulateMessage({
        d: {
          session_id: 'sess_1',
          shard: [0, 1],
          user: { bot: true, id: 'bot_1', username: 'TestBot' },
          version: 1,
        },
        op: QQ_WS_OP_CODES.DISPATCH,
        s: 1,
        t: 'READY',
      });
      await connectPromise;

      ws.close(4000, 'network reset');
      await vi.advanceTimersByTimeAsync(1000);

      expect(MockWebSocket.instances).toHaveLength(2);
    });
  });

  describe('close', () => {
    it('should clean up on close()', async () => {
      const { conn, connectPromise, ws } = await connectAndGetWs();

      ws.simulateMessage({ op: QQ_WS_OP_CODES.HELLO, d: { heartbeat_interval: 45000 } });
      await vi.advanceTimersByTimeAsync(10);

      ws.simulateMessage({
        d: {
          session_id: 'sess_1',
          shard: [0, 1],
          user: { bot: true, id: 'bot_1', username: 'TestBot' },
          version: 1,
        },
        op: QQ_WS_OP_CODES.DISPATCH,
        s: 1,
        t: 'READY',
      });
      await connectPromise;

      conn.close();
      expect(ws.readyState).toBe(MockWebSocket.CLOSED);
    });

    it('should stop on abort signal', async () => {
      const abort = new AbortController();
      const { connectPromise, ws } = await connectAndGetWs({ abortSignal: abort.signal });

      ws.simulateMessage({ op: QQ_WS_OP_CODES.HELLO, d: { heartbeat_interval: 45000 } });
      await vi.advanceTimersByTimeAsync(10);

      ws.simulateMessage({
        d: {
          session_id: 'sess_1',
          shard: [0, 1],
          user: { bot: true, id: 'bot_1', username: 'TestBot' },
          version: 1,
        },
        op: QQ_WS_OP_CODES.DISPATCH,
        s: 1,
        t: 'READY',
      });
      await connectPromise;

      abort.abort();
      expect(ws.readyState).toBe(MockWebSocket.CLOSED);
    });
  });

  describe('sequence tracking', () => {
    it('should track sequence numbers from dispatch events', async () => {
      const { connectPromise, ws } = await connectAndGetWs();

      ws.simulateMessage({ op: QQ_WS_OP_CODES.HELLO, d: { heartbeat_interval: 45000 } });
      await vi.advanceTimersByTimeAsync(10);

      ws.simulateMessage({
        d: {
          session_id: 'sess_1',
          shard: [0, 1],
          user: { bot: true, id: 'bot_1', username: 'TestBot' },
          version: 1,
        },
        op: QQ_WS_OP_CODES.DISPATCH,
        s: 1,
        t: 'READY',
      });
      await connectPromise;

      // Send another event with s=5
      ws.simulateMessage({
        d: { content: 'test' },
        op: QQ_WS_OP_CODES.DISPATCH,
        s: 5,
        t: 'GROUP_AT_MESSAGE_CREATE',
      });

      // Advance to trigger heartbeat
      await vi.advanceTimersByTimeAsync(50000);

      const heartbeats = ws.sentMessages
        .map((m) => JSON.parse(m))
        .filter((p) => p.op === QQ_WS_OP_CODES.HEARTBEAT);

      // Latest heartbeat should use seq=5
      const lastHeartbeat = heartbeats.at(-1);
      expect(lastHeartbeat?.d).toBe(5);
    });
  });
});

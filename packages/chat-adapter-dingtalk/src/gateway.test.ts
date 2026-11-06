import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { verifyCallbackSignature } from './crypto';
import type { DingTalkGatewayOptions } from './gateway';
import { DEFAULT_STREAM_SUBSCRIPTIONS, DingTalkStreamConnection } from './gateway';
import { DINGTALK_STREAM_TOPICS } from './types';

// ---- Mock WebSocket ----

class MockWebSocket {
  static OPEN = 1;
  static CLOSED = 3;
  static instances: MockWebSocket[] = [];
  /** When false, the socket never opens (simulates a rejected handshake). */
  static autoOpen = true;

  readyState = 0;
  url: string;
  sentMessages: string[] = [];
  closeCalls: Array<{ code?: number; reason?: string }> = [];
  /** Half-open TCP: the peer never answers the close frame, so no `close` event fires. */
  hangOnClose = false;
  private listeners = new Map<string, Array<(...args: any[]) => void>>();

  constructor(url: string) {
    this.url = url;
    MockWebSocket.instances.push(this);
    if (MockWebSocket.autoOpen) {
      setTimeout(() => {
        this.readyState = MockWebSocket.OPEN;
        this.emit('open', {});
      }, 0);
    }
  }

  addEventListener(event: string, fn: (...args: any[]) => void) {
    this.listeners.set(event, [...(this.listeners.get(event) || []), fn]);
  }

  removeEventListener(event: string, fn: (...args: any[]) => void) {
    this.listeners.set(
      event,
      (this.listeners.get(event) || []).filter((f) => f !== fn),
    );
  }

  send(data: string) {
    this.sentMessages.push(data);
  }

  close(code?: number, reason?: string) {
    this.closeCalls.push({ code, reason });
    if (this.hangOnClose) return;
    if (this.readyState === MockWebSocket.CLOSED) return;
    this.readyState = MockWebSocket.CLOSED;
    this.emit('close', { code: code ?? 1000, reason: reason ?? '' });
  }

  emit(event: string, data: any) {
    for (const fn of this.listeners.get(event) || []) fn(data);
  }

  simulateFrame(frame: Record<string, any>) {
    this.emit('message', { data: JSON.stringify(frame) });
  }

  sent(): Array<Record<string, any>> {
    return this.sentMessages.map((m) => JSON.parse(m));
  }
}

// ---- Helpers ----

const SECRET = 'test_client_secret';
const WEBHOOK_URL = 'http://localhost:3000/api/agent/webhooks/dingtalk/app_1';

function createMockApi() {
  let n = 0;
  return {
    openStreamConnection: vi.fn().mockImplementation(async () => {
      n++;
      return { endpoint: 'wss://wss-open-connection.dingtalk.com:443/connect', ticket: `t${n}` };
    }),
  } as any;
}

function botFrame(messageId = 'msg_1', data: Record<string, any> = { msgId: 'm1' }) {
  return {
    data: JSON.stringify(data),
    headers: {
      contentType: 'application/json',
      messageId,
      time: String(Date.now()),
      topic: DINGTALK_STREAM_TOPICS.BOT_MESSAGE,
    },
    specVersion: '1.0',
    type: 'CALLBACK',
  };
}

describe('DingTalkStreamConnection', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    MockWebSocket.instances = [];
    MockWebSocket.autoOpen = true;
    vi.stubGlobal('WebSocket', MockWebSocket);
    fetchMock = vi.fn().mockResolvedValue(new Response('ok', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  function create(overrides?: Partial<DingTalkGatewayOptions>) {
    const api = createMockApi();
    const conn = new DingTalkStreamConnection(api, {
      clientSecret: SECRET,
      log: vi.fn(),
      webhookUrl: WEBHOOK_URL,
      ...overrides,
    });
    return { api, conn };
  }

  async function connected(overrides?: Partial<DingTalkGatewayOptions>) {
    const ctx = create(overrides);
    const promise = ctx.conn.connect();
    await vi.advanceTimersByTimeAsync(10);
    await promise;
    return { ...ctx, ws: MockWebSocket.instances[0] };
  }

  describe('handshake', () => {
    it('registers the connection and opens the socket with the ticket', async () => {
      const { api, ws, conn } = await connected();

      expect(api.openStreamConnection).toHaveBeenCalledWith(DEFAULT_STREAM_SUBSCRIPTIONS);
      expect(DEFAULT_STREAM_SUBSCRIPTIONS).toEqual([
        { topic: '/v1.0/im/bot/messages/get', type: 'CALLBACK' },
      ]);
      expect(ws.url).toBe('wss://wss-open-connection.dingtalk.com:443/connect?ticket=t1');
      conn.close();
    });

    it('rejects when registration fails (bad credentials)', async () => {
      const { api, conn } = create();
      api.openStreamConnection.mockRejectedValueOnce(new Error('invalid clientId'));

      await expect(conn.connect()).rejects.toThrow('invalid clientId');
      expect(MockWebSocket.instances).toHaveLength(0);
    });

    it('rejects when the socket closes before opening, without reconnecting', async () => {
      MockWebSocket.autoOpen = false;
      const { api, conn } = create();
      const promise = conn.connect();
      await vi.advanceTimersByTimeAsync(10);

      MockWebSocket.instances[0].close(1006, 'ticket expired');
      await expect(promise).rejects.toThrow(/closed before open: code=1006/);

      await vi.advanceTimersByTimeAsync(120_000);
      expect(api.openStreamConnection).toHaveBeenCalledTimes(1);
    });
  });

  describe('ACK', () => {
    it('echoes ping frames with the same messageId and opaque data', async () => {
      const { ws, conn } = await connected();

      ws.simulateFrame({
        data: '{"opaque":"abc-123"}',
        headers: { messageId: 'ping_1', topic: 'ping' },
        type: 'SYSTEM',
      });

      expect(ws.sent()).toEqual([
        {
          code: 200,
          data: '{"opaque":"abc-123"}',
          headers: { contentType: 'application/json', messageId: 'ping_1' },
          message: 'OK',
        },
      ]);
      expect(fetchMock).not.toHaveBeenCalled();
      conn.close();
    });

    it('ACKs a robot message and forwards it to the webhook with a valid signature', async () => {
      const { ws, conn } = await connected();
      const data = { conversationId: 'cid1', msgId: 'm1', text: { content: 'hi' } };

      ws.simulateFrame(botFrame('cb_1', data));

      expect(ws.sent()).toEqual([
        {
          code: 200,
          data: JSON.stringify({ response: null }),
          headers: { contentType: 'application/json', messageId: 'cb_1' },
          message: 'OK',
        },
      ]);

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url, init] = fetchMock.mock.calls[0];
      expect(url).toBe(WEBHOOK_URL);
      expect(init.method).toBe('POST');
      expect(JSON.parse(init.body)).toEqual(data);
      expect(verifyCallbackSignature(init.headers.timestamp, init.headers.sign, SECRET)).toBe(true);
      conn.close();
    });

    it('answers 404 for an unsubscribed callback topic and does not forward it', async () => {
      const { ws, conn } = await connected();

      ws.simulateFrame({
        data: '{}',
        headers: { messageId: 'card_1', topic: '/v1.0/card/instances/callback' },
        type: 'CALLBACK',
      });

      expect(ws.sent()[0]).toMatchObject({ code: 404, headers: { messageId: 'card_1' } });
      expect(fetchMock).not.toHaveBeenCalled();
      conn.close();
    });

    it('ACKs event frames as SUCCESS so they are not redelivered', async () => {
      const { ws, conn } = await connected();

      ws.simulateFrame({ data: '{}', headers: { messageId: 'ev_1', topic: '*' }, type: 'EVENT' });

      const ack = ws.sent()[0];
      expect(ack.code).toBe(200);
      expect(JSON.parse(ack.data).status).toBe('SUCCESS');
      conn.close();
    });

    it('ignores malformed frames', async () => {
      const { ws, conn } = await connected();
      ws.emit('message', { data: 'not json' });
      expect(ws.sentMessages).toHaveLength(0);
      conn.close();
    });

    it('keeps the socket alive when forwarding fails', async () => {
      fetchMock.mockRejectedValueOnce(new Error('ECONNREFUSED'));
      const { ws, conn } = await connected();

      ws.simulateFrame(botFrame());
      await vi.advanceTimersByTimeAsync(10);

      expect(ws.readyState).toBe(MockWebSocket.OPEN);
      expect(ws.sent()[0].code).toBe(200);
      conn.close();
    });
  });

  describe('reconnect', () => {
    it('reconnects with a fresh ticket after a server disconnect frame', async () => {
      const { api, ws, conn } = await connected();

      ws.simulateFrame({
        data: '{"reason":"connection expired"}',
        headers: { messageId: 'sys_1', topic: 'disconnect' },
        type: 'SYSTEM',
      });
      expect(ws.readyState).toBe(MockWebSocket.CLOSED);

      await vi.advanceTimersByTimeAsync(1100);

      expect(api.openStreamConnection).toHaveBeenCalledTimes(2);
      expect(MockWebSocket.instances).toHaveLength(2);
      expect(MockWebSocket.instances[1].url).toMatch(/ticket=t2$/);
      conn.close();
    });

    it('backs off exponentially when registration keeps failing, then recovers', async () => {
      const { api, ws, conn } = await connected();
      api.openStreamConnection
        .mockRejectedValueOnce(new Error('503'))
        .mockRejectedValueOnce(new Error('503'));

      ws.close(1006, 'network');

      await vi.advanceTimersByTimeAsync(1000); // attempt 1 (1s) fails
      expect(api.openStreamConnection).toHaveBeenCalledTimes(2);
      await vi.advanceTimersByTimeAsync(1500); // attempt 2 not before 2s
      expect(api.openStreamConnection).toHaveBeenCalledTimes(2);
      await vi.advanceTimersByTimeAsync(600); // attempt 2 (2s) fails
      expect(api.openStreamConnection).toHaveBeenCalledTimes(3);
      await vi.advanceTimersByTimeAsync(4100); // attempt 3 (4s) succeeds
      expect(api.openStreamConnection).toHaveBeenCalledTimes(4);

      const latest = MockWebSocket.instances.at(-1)!;
      expect(latest.url).toMatch(/ticket=t\d+$/);
      expect(latest.readyState).toBe(MockWebSocket.OPEN);

      // attempts reset after a successful open: next drop retries after 1s again
      latest.close(1006, 'network');
      await vi.advanceTimersByTimeAsync(1100);
      expect(api.openStreamConnection).toHaveBeenCalledTimes(5);
      conn.close();
    });

    it('replaces a silent (half-open) connection after the idle timeout', async () => {
      const { api, ws, conn } = await connected({ idleTimeoutMs: 10_000 });

      await vi.advanceTimersByTimeAsync(5000);
      ws.simulateFrame({
        data: '{"opaque":"1"}',
        headers: { messageId: 'p', topic: 'ping' },
        type: 'SYSTEM',
      });
      await vi.advanceTimersByTimeAsync(8000);
      expect(ws.readyState).toBe(MockWebSocket.OPEN); // ping reset the idle clock

      await vi.advanceTimersByTimeAsync(5000);
      expect(ws.closeCalls.at(-1)).toEqual({ code: 4000, reason: 'Idle timeout' });

      await vi.advanceTimersByTimeAsync(1100);
      expect(api.openStreamConnection).toHaveBeenCalledTimes(2);
      conn.close();
    });

    it('reconnects after the idle timeout even when the half-open socket never emits close', async () => {
      const { api, ws, conn } = await connected({ idleTimeoutMs: 10_000 });
      ws.hangOnClose = true;

      await vi.advanceTimersByTimeAsync(15_000);
      expect(ws.closeCalls.at(-1)).toEqual({ code: 4000, reason: 'Idle timeout' });

      await vi.advanceTimersByTimeAsync(1100);
      expect(api.openStreamConnection).toHaveBeenCalledTimes(2);

      // The retired socket finally closing (TCP timeout) must not trigger another reconnect.
      ws.hangOnClose = false;
      ws.readyState = MockWebSocket.OPEN;
      ws.close(1006, 'tcp timeout');
      await vi.advanceTimersByTimeAsync(5000);
      expect(api.openStreamConnection).toHaveBeenCalledTimes(2);
      conn.close();
    });

    it('does not reconnect after close()', async () => {
      const { api, ws, conn } = await connected();
      conn.close();

      expect(ws.closeCalls[0]).toEqual({ code: 1000, reason: 'Client shutdown' });
      await vi.advanceTimersByTimeAsync(120_000);
      expect(api.openStreamConnection).toHaveBeenCalledTimes(1);
    });

    it('stops on abort signal', async () => {
      const controller = new AbortController();
      const { api, ws } = await connected({ abortSignal: controller.signal });

      controller.abort();
      expect(ws.readyState).toBe(MockWebSocket.CLOSED);
      await vi.advanceTimersByTimeAsync(120_000);
      expect(api.openStreamConnection).toHaveBeenCalledTimes(1);
    });

    it('closes after durationMs so the caller can restart it', async () => {
      const { api, ws } = await connected({ durationMs: 30_000 });

      await vi.advanceTimersByTimeAsync(30_000);
      expect(ws.readyState).toBe(MockWebSocket.CLOSED);
      await vi.advanceTimersByTimeAsync(120_000);
      expect(api.openStreamConnection).toHaveBeenCalledTimes(1);
    });
  });
});

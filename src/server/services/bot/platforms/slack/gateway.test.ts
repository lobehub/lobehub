import { createHmac } from 'node:crypto';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { SlackSocketModeOptions } from './gateway';
import { SlackSocketModeConnection } from './gateway';

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

// ---- Tests ----

describe('SlackSocketModeConnection', () => {
  beforeEach(() => {
    MockWebSocket.instances = [];
    vi.stubGlobal('WebSocket', MockWebSocket);
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation((url: string) => {
        if (url.includes('apps.connections.open')) {
          return Promise.resolve(
            new Response(
              JSON.stringify({ ok: true, url: 'wss://mock-slack.com/link/?ticket=test' }),
              { headers: { 'Content-Type': 'application/json' }, status: 200 },
            ),
          );
        }
        return Promise.resolve(new Response('ok', { status: 200 }));
      }),
    );
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  function createConnection(overrides?: Partial<SlackSocketModeOptions>) {
    const options: SlackSocketModeOptions = {
      appToken: 'xapp-test-token',
      signingSecret: 'test-signing-secret',
      webhookUrl: 'http://localhost:3000/api/agent/webhooks/slack/test_app',
      ...overrides,
    };
    return new SlackSocketModeConnection(options);
  }

  async function connectAndGetWs(overrides?: Partial<SlackSocketModeOptions>) {
    const conn = createConnection(overrides);
    const connectPromise = conn.connect();
    await vi.advanceTimersByTimeAsync(10);
    const ws = MockWebSocket.instances[0];
    return { conn, connectPromise, ws };
  }

  describe('connect', () => {
    it('should call apps.connections.open and connect to WSS URL', async () => {
      const { connectPromise, ws } = await connectAndGetWs();

      expect(fetch).toHaveBeenCalledWith(
        expect.stringContaining('apps.connections.open'),
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: 'Bearer xapp-test-token',
          }),
        }),
      );
      expect(ws.url).toBe('wss://mock-slack.com/link/?ticket=test');

      ws.simulateMessage({ type: 'hello', connection_info: { app_id: 'A123' } });
      await connectPromise;
    });

    it('should resolve on hello message', async () => {
      const { connectPromise, ws } = await connectAndGetWs();

      ws.simulateMessage({ type: 'hello' });
      await connectPromise;
    });

    it('should resolve immediately when abortSignal is already aborted', async () => {
      const abort = new AbortController();
      abort.abort();
      const conn = createConnection({ abortSignal: abort.signal });
      await conn.connect();
    });
  });

  describe('event handling', () => {
    function getForwardCall() {
      return vi
        .mocked(fetch)
        .mock.calls.find(
          (call) => typeof call[0] === 'string' && call[0].includes('webhooks/slack'),
        );
    }

    function expectSlackSignature(forwardCall: ReturnType<typeof getForwardCall>, body: string) {
      const headers = forwardCall?.[1]?.headers as Record<string, string>;
      const timestamp = headers['x-slack-request-timestamp'];
      const expectedSignature =
        'v0=' +
        createHmac('sha256', 'test-signing-secret').update(`v0:${timestamp}:${body}`).digest('hex');

      expect(headers['x-slack-signature']).toBe(expectedSignature);
      expect(Number(timestamp)).toBeGreaterThan(0);
    }

    it('should acknowledge events by sending envelope_id', async () => {
      const { connectPromise, ws } = await connectAndGetWs();
      ws.simulateMessage({ type: 'hello' });
      await connectPromise;

      ws.simulateMessage({
        accepts_response_payload: false,
        envelope_id: 'env_123',
        payload: { event: { type: 'app_mention', text: 'hello' } },
        type: 'events_api',
      });

      const ack = ws.getLastSentPayload();
      expect(ack).toEqual({ envelope_id: 'env_123' });
    });

    it('should forward events to webhook URL', async () => {
      const { connectPromise, ws } = await connectAndGetWs();
      ws.simulateMessage({ type: 'hello' });
      await connectPromise;

      const eventPayload = { event: { text: 'hello', type: 'app_mention' } };
      ws.simulateMessage({
        envelope_id: 'env_456',
        payload: eventPayload,
        type: 'events_api',
      });

      await vi.advanceTimersByTimeAsync(10);

      const forwardCall = getForwardCall();
      expect(forwardCall).toBeDefined();

      const body = forwardCall![1]!.body as string;
      expect(JSON.parse(body)).toEqual(eventPayload);
      expect(forwardCall![1]!.headers).toEqual(
        expect.objectContaining({ 'Content-Type': 'application/json' }),
      );
      expectSlackSignature(forwardCall, body);
    });

    it('should forward slash commands as form-urlencoded payloads', async () => {
      const { connectPromise, ws } = await connectAndGetWs();
      ws.simulateMessage({ type: 'hello' });
      await connectPromise;

      ws.simulateMessage({
        envelope_id: 'env_cmd',
        payload: {
          channel_id: 'C123',
          command: '/new',
          text: 'hello world',
          trigger_id: 'trigger-123',
          user_id: 'U123',
        },
        type: 'slash_commands',
      });

      await vi.advanceTimersByTimeAsync(10);

      const forwardCall = getForwardCall();
      expect(forwardCall).toBeDefined();

      const body = forwardCall![1]!.body as string;
      const params = new URLSearchParams(body);

      expect(forwardCall![1]!.headers).toEqual(
        expect.objectContaining({ 'Content-Type': 'application/x-www-form-urlencoded' }),
      );
      expect(params.get('command')).toBe('/new');
      expect(params.get('text')).toBe('hello world');
      expect(params.get('channel_id')).toBe('C123');
      expectSlackSignature(forwardCall, body);
    });

    it('should forward interactive payloads as form-urlencoded payload field', async () => {
      const { connectPromise, ws } = await connectAndGetWs();
      ws.simulateMessage({ type: 'hello' });
      await connectPromise;

      const payload = {
        actions: [{ action_id: 'retry', value: '1' }],
        type: 'block_actions',
      };

      ws.simulateMessage({
        envelope_id: 'env_int',
        payload,
        type: 'interactive',
      });

      await vi.advanceTimersByTimeAsync(10);

      const forwardCall = getForwardCall();
      expect(forwardCall).toBeDefined();

      const body = forwardCall![1]!.body as string;
      const params = new URLSearchParams(body);

      expect(forwardCall![1]!.headers).toEqual(
        expect.objectContaining({ 'Content-Type': 'application/x-www-form-urlencoded' }),
      );
      expect(JSON.parse(params.get('payload') || '')).toEqual(payload);
      expectSlackSignature(forwardCall, body);
    });

    it('should acknowledge slash_commands', async () => {
      const { connectPromise, ws } = await connectAndGetWs();
      ws.simulateMessage({ type: 'hello' });
      await connectPromise;

      ws.simulateMessage({
        envelope_id: 'env_cmd',
        payload: { command: '/new' },
        type: 'slash_commands',
      });

      const ack = ws.getLastSentPayload();
      expect(ack).toEqual({ envelope_id: 'env_cmd' });
    });

    it('should acknowledge interactive payloads', async () => {
      const { connectPromise, ws } = await connectAndGetWs();
      ws.simulateMessage({ type: 'hello' });
      await connectPromise;

      ws.simulateMessage({
        envelope_id: 'env_int',
        payload: { type: 'block_actions' },
        type: 'interactive',
      });

      const ack = ws.getLastSentPayload();
      expect(ack).toEqual({ envelope_id: 'env_int' });
    });
  });

  describe('disconnect handling', () => {
    it('should close on link_disabled disconnect', async () => {
      const { connectPromise, ws } = await connectAndGetWs();
      ws.simulateMessage({ type: 'hello' });
      await connectPromise;

      ws.simulateMessage({ reason: 'link_disabled', type: 'disconnect' });
      expect(ws.readyState).toBe(MockWebSocket.CLOSED);
    });

    it('should reconnect on refresh_requested disconnect', async () => {
      const { connectPromise, ws } = await connectAndGetWs();
      ws.simulateMessage({ type: 'hello' });
      await connectPromise;

      ws.simulateMessage({ reason: 'refresh_requested', type: 'disconnect' });
      expect(ws.readyState).toBe(MockWebSocket.CLOSED);
    });
  });

  describe('close', () => {
    it('should clean up on close()', async () => {
      const { conn, connectPromise, ws } = await connectAndGetWs();
      ws.simulateMessage({ type: 'hello' });
      await connectPromise;

      conn.close();
      expect(ws.readyState).toBe(MockWebSocket.CLOSED);
    });

    it('should stop on abort signal', async () => {
      const abort = new AbortController();
      const { connectPromise, ws } = await connectAndGetWs({ abortSignal: abort.signal });
      ws.simulateMessage({ type: 'hello' });
      await connectPromise;

      abort.abort();
      expect(ws.readyState).toBe(MockWebSocket.CLOSED);
    });
  });
});

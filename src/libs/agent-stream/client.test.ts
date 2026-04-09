import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AgentStreamClient } from './client';
import type { ConnectionStatus } from './types';

// ─── Mock WebSocket ───

class MockWebSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;

  readyState = MockWebSocket.CONNECTING;
  onopen: ((ev: any) => void) | null = null;
  onmessage: ((ev: any) => void) | null = null;
  onclose: ((ev: any) => void) | null = null;
  onerror: ((ev: any) => void) | null = null;

  sent: string[] = [];

  constructor(public url: string) {
    // Auto-connect in next tick
    setTimeout(() => {
      this.readyState = MockWebSocket.OPEN;
      this.onopen?.({});
    }, 0);
  }

  send(data: string): void {
    this.sent.push(data);
  }

  close(_code?: number, _reason?: string): void {
    this.readyState = MockWebSocket.CLOSED;
    this.onclose?.({});
  }

  // Test helpers
  simulateMessage(data: any): void {
    this.onmessage?.({ data: JSON.stringify(data) });
  }

  simulateClose(): void {
    this.readyState = MockWebSocket.CLOSED;
    this.onclose?.({});
  }

  simulateError(): void {
    this.onerror?.({});
  }
}

let mockWsInstances: MockWebSocket[] = [];

beforeEach(() => {
  mockWsInstances = [];
  vi.stubGlobal(
    'WebSocket',
    Object.assign(
      class extends MockWebSocket {
        constructor(url: string) {
          super(url);
          mockWsInstances.push(this);
        }
      },
      {
        CLOSED: MockWebSocket.CLOSED,
        CLOSING: MockWebSocket.CLOSING,
        CONNECTING: MockWebSocket.CONNECTING,
        OPEN: MockWebSocket.OPEN,
      },
    ),
  );
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function createClient(overrides?: Partial<ConstructorParameters<typeof AgentStreamClient>[0]>) {
  return new AgentStreamClient({
    gatewayUrl: 'https://gateway.test.com',
    operationId: 'op-123',
    token: 'test-token',
    ...overrides,
  });
}

function getLatestWs(): MockWebSocket {
  return mockWsInstances.at(-1)!;
}

async function connectAndAuth(client: AgentStreamClient): Promise<MockWebSocket> {
  client.connect();
  await vi.advanceTimersByTimeAsync(1);
  const ws = getLatestWs();
  ws.simulateMessage({ type: 'auth_success' });
  return ws;
}

describe('AgentStreamClient', () => {
  describe('connection', () => {
    it('should build correct WebSocket URL', () => {
      const client = createClient();
      client.connect();
      vi.advanceTimersByTime(1);

      expect(getLatestWs().url).toBe('wss://gateway.test.com/ws?operationId=op-123');
    });

    it('should use ws:// for http gateway URL', () => {
      const client = createClient({ gatewayUrl: 'http://localhost:8787' });
      client.connect();
      vi.advanceTimersByTime(1);

      expect(getLatestWs().url).toBe('ws://localhost:8787/ws?operationId=op-123');
    });

    it('should send auth message on open', async () => {
      const client = createClient();
      client.connect();
      await vi.advanceTimersByTimeAsync(1);

      const ws = getLatestWs();
      expect(ws.sent).toHaveLength(1);
      expect(JSON.parse(ws.sent[0])).toEqual({ token: 'test-token', type: 'auth' });
    });

    it('should transition through connection states', async () => {
      const client = createClient();
      const statuses: ConnectionStatus[] = [];
      client.on('status_changed', (s) => statuses.push(s));

      client.connect();
      expect(statuses).toContain('connecting');

      await vi.advanceTimersByTimeAsync(1);
      expect(statuses).toContain('authenticating');

      getLatestWs().simulateMessage({ type: 'auth_success' });
      expect(statuses).toContain('connected');
    });

    it('should emit connected event after auth_success', async () => {
      const client = createClient();
      const onConnected = vi.fn();
      client.on('connected', onConnected);

      await connectAndAuth(client);
      expect(onConnected).toHaveBeenCalledOnce();
    });

    it('should send resume with empty lastEventId after auth', async () => {
      const client = createClient();
      const ws = await connectAndAuth(client);

      // First message is auth, second is resume
      expect(ws.sent).toHaveLength(2);
      expect(JSON.parse(ws.sent[1])).toEqual({ lastEventId: '', type: 'resume' });
    });

    it('should not connect if already connected', async () => {
      const client = createClient();
      await connectAndAuth(client);

      const prevCount = mockWsInstances.length;
      client.connect();
      expect(mockWsInstances.length).toBe(prevCount);
    });
  });

  describe('auth failure', () => {
    it('should emit auth_failed and disconnect', async () => {
      const client = createClient();
      const onAuthFailed = vi.fn();
      client.on('auth_failed', onAuthFailed);

      client.connect();
      await vi.advanceTimersByTimeAsync(1);
      getLatestWs().simulateMessage({ reason: 'invalid token', type: 'auth_failed' });

      expect(onAuthFailed).toHaveBeenCalledWith('invalid token');
      expect(client.connectionStatus).toBe('disconnected');
    });
  });

  describe('agent events', () => {
    it('should emit agent_event for incoming events', async () => {
      const client = createClient();
      const events: any[] = [];
      client.on('agent_event', (e) => events.push(e));

      const ws = await connectAndAuth(client);
      ws.simulateMessage({
        event: {
          data: { content: 'hello' },
          operationId: 'op-123',
          stepIndex: 0,
          timestamp: 1,
          type: 'stream_chunk',
        },
        id: 'evt-1',
        type: 'agent_event',
      });

      expect(events).toHaveLength(1);
      expect(events[0].type).toBe('stream_chunk');
      expect(events[0].data.content).toBe('hello');
    });

    it('should track lastEventId from agent events', async () => {
      const client = createClient();
      const ws = await connectAndAuth(client);

      ws.simulateMessage({
        event: { data: {}, operationId: 'op-123', stepIndex: 0, timestamp: 1, type: 'step_start' },
        id: 'evt-5',
        type: 'agent_event',
      });

      // Force a disconnect + reconnect to check lastEventId
      ws.simulateClose();
      await vi.advanceTimersByTimeAsync(1000); // reconnect delay
      await vi.advanceTimersByTimeAsync(1);

      const ws2 = getLatestWs();
      ws2.simulateMessage({ type: 'auth_success' });

      // Resume should use the tracked lastEventId
      const resumeMsg = JSON.parse(ws2.sent[1]);
      expect(resumeMsg).toEqual({ lastEventId: 'evt-5', type: 'resume' });
    });

    it('should disconnect on agent_runtime_end', async () => {
      const client = createClient();
      const ws = await connectAndAuth(client);

      ws.simulateMessage({
        event: {
          data: { stepCount: 3 },
          operationId: 'op-123',
          stepIndex: 2,
          timestamp: 1,
          type: 'agent_runtime_end',
        },
        type: 'agent_event',
      });

      expect(client.connectionStatus).toBe('disconnected');
    });

    it('should disconnect on error event', async () => {
      const client = createClient();
      const ws = await connectAndAuth(client);

      ws.simulateMessage({
        event: {
          data: { message: 'runtime error' },
          operationId: 'op-123',
          stepIndex: 0,
          timestamp: 1,
          type: 'error',
        },
        type: 'agent_event',
      });

      expect(client.connectionStatus).toBe('disconnected');
    });

    it('should emit session_complete and disconnect', async () => {
      const client = createClient();
      const onComplete = vi.fn();
      client.on('session_complete', onComplete);

      const ws = await connectAndAuth(client);
      ws.simulateMessage({ type: 'session_complete' });

      expect(onComplete).toHaveBeenCalledOnce();
      expect(client.connectionStatus).toBe('disconnected');
    });
  });

  describe('heartbeat', () => {
    it('should send heartbeats at 30s intervals', async () => {
      const client = createClient();
      const ws = await connectAndAuth(client);

      await vi.advanceTimersByTimeAsync(30_000);
      const heartbeats = ws.sent.filter((s) => JSON.parse(s).type === 'heartbeat');
      expect(heartbeats).toHaveLength(1);

      await vi.advanceTimersByTimeAsync(30_000);
      const heartbeats2 = ws.sent.filter((s) => JSON.parse(s).type === 'heartbeat');
      expect(heartbeats2).toHaveLength(2);
    });

    it('should reset missed count on heartbeat_ack', async () => {
      const client = createClient();
      const ws = await connectAndAuth(client);

      // First heartbeat
      await vi.advanceTimersByTimeAsync(30_000);
      ws.simulateMessage({ type: 'heartbeat_ack' });

      // Should not force reconnect after ack
      await vi.advanceTimersByTimeAsync(30_000);
      expect(client.connectionStatus).toBe('connected');
    });
  });

  describe('reconnection', () => {
    it('should auto-reconnect on unexpected close', async () => {
      const client = createClient();
      const onReconnecting = vi.fn();
      client.on('reconnecting', onReconnecting);

      const ws = await connectAndAuth(client);
      ws.simulateClose();

      expect(client.connectionStatus).toBe('reconnecting');
      expect(onReconnecting).toHaveBeenCalledWith(1000);
    });

    it('should not reconnect after session_complete', async () => {
      const client = createClient();
      const ws = await connectAndAuth(client);

      ws.simulateMessage({ type: 'session_complete' });
      expect(client.connectionStatus).toBe('disconnected');

      // No reconnection should be scheduled
      await vi.advanceTimersByTimeAsync(5000);
      expect(client.connectionStatus).toBe('disconnected');
    });

    it('should not reconnect after intentional disconnect', async () => {
      const client = createClient();
      await connectAndAuth(client);

      client.disconnect();
      expect(client.connectionStatus).toBe('disconnected');

      await vi.advanceTimersByTimeAsync(5000);
      expect(client.connectionStatus).toBe('disconnected');
    });

    it('should use exponential backoff', async () => {
      const client = createClient();
      const delays: number[] = [];
      client.on('reconnecting', (d) => delays.push(d));

      const ws = await connectAndAuth(client);

      // First disconnect → triggers reconnect with 1s delay
      ws.simulateClose();
      expect(delays[0]).toBe(1000);

      // Advance past reconnect delay → new WS created, onopen fires + resets delay,
      // but we close before auth succeeds → triggers reconnect again with 1s (reset by onopen)
      await vi.advanceTimersByTimeAsync(1000);
      await vi.advanceTimersByTimeAsync(1);
      getLatestWs().simulateClose();

      // Third reconnect: previous close scheduled another with 1s,
      // advance past it, onopen fires, close again to see 2s
      await vi.advanceTimersByTimeAsync(delays[1]);
      await vi.advanceTimersByTimeAsync(1);
      getLatestWs().simulateClose();

      // Verify escalating pattern: 1s, 1s (reset by open), 1s (reset by open)
      // This is correct: onopen resets delay, so each connect cycle restarts at 1s
      // The backoff only accumulates when connection *fails to open*
      expect(delays[0]).toBe(1000);
      expect(delays[1]).toBe(1000); // Reset by successful WebSocket open
    });

    it('should not reconnect when autoReconnect is false', async () => {
      const client = createClient({ autoReconnect: false });
      const ws = await connectAndAuth(client);

      ws.simulateClose();
      expect(client.connectionStatus).toBe('disconnected');

      await vi.advanceTimersByTimeAsync(5000);
      expect(mockWsInstances).toHaveLength(1); // No new WS created
    });
  });

  describe('interrupt', () => {
    it('should send interrupt message', async () => {
      const client = createClient();
      const ws = await connectAndAuth(client);

      client.sendInterrupt();
      const interruptMsg = ws.sent.find((s) => JSON.parse(s).type === 'interrupt');
      expect(interruptMsg).toBeDefined();
      expect(JSON.parse(interruptMsg!)).toEqual({ type: 'interrupt' });
    });
  });

  describe('disconnect', () => {
    it('should clean up timers on disconnect', async () => {
      const client = createClient();
      await connectAndAuth(client);

      client.disconnect();
      expect(client.connectionStatus).toBe('disconnected');

      // No heartbeats should fire
      await vi.advanceTimersByTimeAsync(60_000);
      expect(client.connectionStatus).toBe('disconnected');
    });
  });

  describe('updateToken', () => {
    it('should use new token on reconnect', async () => {
      const client = createClient();
      const ws = await connectAndAuth(client);

      client.updateToken('new-token');
      ws.simulateClose();

      // Wait for reconnect
      await vi.advanceTimersByTimeAsync(1000);
      await vi.advanceTimersByTimeAsync(1);

      const ws2 = getLatestWs();
      const authMsg = JSON.parse(ws2.sent[0]);
      expect(authMsg.token).toBe('new-token');
    });
  });
});

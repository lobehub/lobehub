import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { AgentStreamClient } from '../client';
import type { ConnectionStatus } from '../types';
import { createOperationClient } from './createOperationClient';
import { GatewayMuxClient } from './GatewayMuxClient';
import type { MuxServerMessage } from './types';

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
    setTimeout(() => {
      this.readyState = MockWebSocket.OPEN;
      this.onopen?.({});
    }, 0);
  }

  send(data: string): void {
    this.sent.push(data);
  }

  close(): void {
    this.readyState = MockWebSocket.CLOSED;
    this.onclose?.({ code: 1000, reason: '' });
  }

  simulateMessage(data: MuxServerMessage): void {
    this.onmessage?.({ data: JSON.stringify(data) });
  }

  simulateClose(code = 1006, reason = ''): void {
    this.readyState = MockWebSocket.CLOSED;
    this.onclose?.({ code, reason });
  }

  get messages(): any[] {
    return this.sent.map((s) => JSON.parse(s));
  }

  ofType(type: string): any[] {
    return this.messages.filter((m) => m.type === type);
  }
}

let mockWsInstances: MockWebSocket[] = [];
/** Muxes created by the current test; torn down so their window listeners don't leak. */
let muxes: GatewayMuxClient[] = [];

beforeEach(() => {
  mockWsInstances = [];
  muxes = [];
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
  vi.spyOn(Math, 'random').mockReturnValue(0.5);
});

afterEach(() => {
  for (const mux of muxes) mux.disconnect();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const READY: MuxServerMessage = {
  connectionId: 'conn-1',
  protocol: 2,
  type: 'ready',
  userId: 'user-1',
};

function createMux() {
  const mux = new GatewayMuxClient({
    clientId: 'cid',
    gatewayUrl: 'https://gateway.test.com',
    getToken: async () => 'tok',
  });
  muxes.push(mux);
  return mux;
}

function getLatestWs(): MockWebSocket {
  return mockWsInstances.at(-1)!;
}

async function settle(): Promise<MockWebSocket> {
  await vi.advanceTimersByTimeAsync(1);
  return getLatestWs();
}

async function readyMux(mux: GatewayMuxClient): Promise<MockWebSocket> {
  const pending = mux.connect();
  const ws = await settle();
  ws.simulateMessage(READY);
  await pending;
  return ws;
}

const agentEvent = (
  id: string,
  type = 'stream_chunk',
  eventOperationId = 'op-1',
): MuxServerMessage => ({
  event: { data: { id }, operationId: eventOperationId, stepIndex: 0, timestamp: 1, type } as any,
  id,
  operationId: 'op-1',
  type: 'agent_event',
});

/** The store's `GatewayConnection['client']` contract (kept in sync by hand). */
type StoreClient = Pick<
  AgentStreamClient,
  'connect' | 'disconnect' | 'on' | 'reconnect' | 'sendToolResult' | 'updateToken'
>;

describe('createOperationClient', () => {
  it('is assignable to the store client Pick of AgentStreamClient', () => {
    const client = createOperationClient(createMux(), 'op-1');
    const storeClient: StoreClient = client;
    expect(storeClient).toBe(client);
    expect(typeof storeClient.connect).toBe('function');
    expect(typeof storeClient.reconnect).toBe('function');
    expect(typeof storeClient.sendToolResult).toBe('function');
  });

  it('connect() subscribes on a shared open socket and emits connecting → connected', async () => {
    const mux = createMux();
    const ws = await readyMux(mux);
    const client = createOperationClient(mux, 'op-1', { executor: true, lastEventId: '4' });
    const statuses: ConnectionStatus[] = [];
    const onConnected = vi.fn();
    client.on('status_changed', (s) => statuses.push(s));
    client.on('connected', onConnected);

    client.connect();
    client.connect(); // idempotent while the subscription is live

    expect(ws.ofType('subscribe')).toEqual([
      { executor: true, lastEventId: '4', operationId: 'op-1', type: 'subscribe' },
    ]);
    expect(statuses).toEqual(['connected']);
    expect(onConnected).toHaveBeenCalledOnce();
    expect(client.connectionStatus).toBe('connected');
  });

  it('connect() before the socket is up dials once and connects when ready arrives', async () => {
    const mux = createMux();
    const client = createOperationClient(mux, 'op-1');
    const statuses: ConnectionStatus[] = [];
    client.on('status_changed', (s) => statuses.push(s));

    client.connect();
    expect(statuses).toEqual(['connecting']);
    const ws = await settle();
    ws.simulateMessage(READY);

    expect(statuses).toEqual(['connecting', 'connected']);
    expect(ws.ofType('subscribe')).toEqual([{ operationId: 'op-1', type: 'subscribe' }]);
  });

  it('forwards agent_event and resume_complete', async () => {
    const mux = createMux();
    const ws = await readyMux(mux);
    const client = createOperationClient(mux, 'op-1');
    const events: any[] = [];
    const onResume = vi.fn();
    client.on('agent_event', (e) => events.push(e));
    client.on('resume_complete', onResume);
    client.connect();

    ws.simulateMessage(agentEvent('1'));
    ws.simulateMessage({
      gap: true,
      operationId: 'op-1',
      status: 'running',
      type: 'resume_complete',
    });

    expect(events.map((e) => e.data.id)).toEqual(['1']);
    expect(onResume).toHaveBeenCalledWith({ gap: true, pending: undefined, status: 'running' });
  });

  it('own terminal event emits session_complete then disconnected (v1 order) and unsubscribes', async () => {
    const mux = createMux();
    const ws = await readyMux(mux);
    const client = createOperationClient(mux, 'op-1');
    const order: string[] = [];
    client.on('agent_event', (e) => order.push(`event:${e.type}`));
    client.on('session_complete', (c) => order.push(`complete:${c.source}`));
    client.on('status_changed', (s) => order.push(`status:${s}`));
    client.on('disconnected', () => order.push('disconnected'));
    client.connect();

    ws.simulateMessage(agentEvent('1', 'agent_runtime_end', 'op-member'));
    ws.simulateMessage(agentEvent('2', 'agent_runtime_end'));

    expect(order).toEqual([
      'status:connected',
      'event:agent_runtime_end',
      'event:agent_runtime_end',
      'complete:agent_event',
      'status:disconnected',
      'disconnected',
    ]);
    expect(ws.ofType('unsubscribe')).toEqual([{ operationId: 'op-1', type: 'unsubscribe' }]);
    expect(client.connectionStatus).toBe('disconnected');
  });

  it('session_complete and terminal resume_complete keep the v1 completion shapes', async () => {
    const mux = createMux();
    const ws = await readyMux(mux);

    const raw = createOperationClient(mux, 'op-1');
    const onRaw = vi.fn();
    raw.on('session_complete', onRaw);
    raw.connect();
    ws.simulateMessage({ id: '1', operationId: 'op-1', type: 'session_complete' });
    expect(onRaw).toHaveBeenCalledWith({ source: 'raw_session_complete' });

    const resumed = createOperationClient(mux, 'op-2');
    const onResumed = vi.fn();
    resumed.on('session_complete', onResumed);
    resumed.connect();
    ws.simulateMessage({
      gap: false,
      operationId: 'op-2',
      status: 'interrupted',
      type: 'resume_complete',
    });
    expect(onResumed).toHaveBeenCalledWith({ source: 'resume_status', status: 'interrupted' });
  });

  it('disconnect() unsubscribes and emits disconnected like v1', async () => {
    const mux = createMux();
    const ws = await readyMux(mux);
    const client = createOperationClient(mux, 'op-1');
    const onDisconnected = vi.fn();
    const onComplete = vi.fn();
    client.on('disconnected', onDisconnected);
    client.on('session_complete', onComplete);
    client.connect();

    client.disconnect();
    expect(ws.ofType('unsubscribe')).toEqual([{ operationId: 'op-1', type: 'unsubscribe' }]);
    expect(onDisconnected).toHaveBeenCalledOnce();
    expect(onComplete).not.toHaveBeenCalled();
    expect(client.connectionStatus).toBe('disconnected');

    // Late messages for the old subscription are ignored.
    const late = vi.fn();
    client.on('agent_event', late);
    ws.simulateMessage(agentEvent('1'));
    expect(late).not.toHaveBeenCalled();
  });

  it('reconnect() resubscribes from the last applied event id without emitting disconnected', async () => {
    const mux = createMux();
    const ws = await readyMux(mux);
    const client = createOperationClient(mux, 'op-1', { executor: true });
    const onDisconnected = vi.fn();
    const events: string[] = [];
    client.on('disconnected', onDisconnected);
    client.on('agent_event', (e) => events.push(e.data.id));
    client.connect();
    ws.simulateMessage(agentEvent('9'));

    client.updateToken('ignored'); // no-op in v2: the mux refreshes via getToken
    await client.reconnect();

    expect(ws.messages).toEqual([
      { executor: true, operationId: 'op-1', type: 'subscribe' },
      { operationId: 'op-1', type: 'unsubscribe' },
      { executor: true, lastEventId: '9', operationId: 'op-1', type: 'subscribe' },
    ]);
    expect(onDisconnected).not.toHaveBeenCalled();

    // The new subscription streams and dedups against the carried-over cursor.
    ws.simulateMessage(agentEvent('9'));
    ws.simulateMessage(agentEvent('10'));
    expect(events).toEqual(['9', '10']);
  });

  it('connect() after a terminal completion resubscribes from the last event id', async () => {
    const mux = createMux();
    const ws = await readyMux(mux);
    const client = createOperationClient(mux, 'op-1');
    client.connect();
    ws.simulateMessage(agentEvent('3', 'agent_runtime_end'));

    client.connect();
    expect(ws.ofType('subscribe')).toEqual([
      { operationId: 'op-1', type: 'subscribe' },
      { lastEventId: '3', operationId: 'op-1', type: 'subscribe' },
    ]);
  });

  it('sendToolResult goes out with the operationId; false before connect', async () => {
    const mux = createMux();
    const ws = await readyMux(mux);
    const client = createOperationClient(mux, 'op-1');

    expect(client.sendToolResult({ content: null, success: false, toolCallId: 'x' })).toBe(false);

    client.connect();
    expect(client.sendToolResult({ content: '{"a":1}', success: true, toolCallId: 'call_1' })).toBe(
      true,
    );
    expect(ws.ofType('tool_result')).toEqual([
      {
        content: '{"a":1}',
        operationId: 'op-1',
        success: true,
        toolCallId: 'call_1',
        type: 'tool_result',
      },
    ]);
    // No client here can send `interrupt`: the op DO ignores it and a stop
    // must go through `aiAgent.interruptTask` instead.
    expect(ws.ofType('interrupt')).toEqual([]);
  });

  it('socket loss surfaces reconnecting, not disconnected; resubscribes after reconnect', async () => {
    const mux = createMux();
    const ws = await readyMux(mux);
    const client = createOperationClient(mux, 'op-1');
    const statuses: ConnectionStatus[] = [];
    const onDisconnected = vi.fn();
    const onReconnecting = vi.fn();
    client.on('status_changed', (s) => statuses.push(s));
    client.on('disconnected', onDisconnected);
    client.on('reconnecting', onReconnecting);
    client.connect();
    ws.simulateMessage(agentEvent('5'));

    ws.simulateClose();
    expect(onReconnecting).toHaveBeenCalledWith(500);
    expect(onDisconnected).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(500);
    const ws2 = await settle();
    ws2.simulateMessage(READY);

    expect(statuses).toEqual(['connected', 'reconnecting', 'connected']);
    expect(ws2.ofType('subscribe')).toEqual([
      { lastEventId: '5', operationId: 'op-1', type: 'subscribe' },
    ]);
  });

  it('forwards auth_failed after the mux gives up on 4401', async () => {
    const mux = createMux();
    const client = createOperationClient(mux, 'op-1');
    const onAuthFailed = vi.fn();
    const onDisconnected = vi.fn();
    client.on('auth_failed', onAuthFailed);
    client.on('disconnected', onDisconnected);
    client.connect();

    let ws = await settle();
    ws.simulateClose(4401, 'auth_failed');
    ws = await settle();
    ws.simulateClose(4401, 'auth_failed');
    ws = await settle();
    ws.simulateClose(4401, 'auth_failed');

    expect(onAuthFailed).toHaveBeenCalledWith('auth_failed');
    expect(onDisconnected).toHaveBeenCalledOnce();
    expect(client.connectionStatus).toBe('disconnected');
  });

  it('on() returns an unsubscribe function', async () => {
    const mux = createMux();
    const ws = await readyMux(mux);
    const client = createOperationClient(mux, 'op-1');
    const listener = vi.fn();
    const off = client.on('agent_event', listener);
    client.connect();

    ws.simulateMessage(agentEvent('1'));
    off();
    ws.simulateMessage(agentEvent('2'));
    expect(listener).toHaveBeenCalledOnce();
  });
});

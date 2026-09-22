import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { GatewayMuxClient } from './GatewayMuxClient';
import type { GatewayMuxClientOptions, MuxServerMessage } from './types';

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
  closedWith: { code?: number; reason?: string } | null = null;

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

  close(code?: number, reason?: string): void {
    this.closedWith = { code, reason };
    this.readyState = MockWebSocket.CLOSED;
    this.onclose?.({ code: 1000, reason: '' });
  }

  // Test helpers
  simulateMessage(data: MuxServerMessage): void {
    this.onmessage?.({ data: JSON.stringify(data) });
  }

  simulateClose(code = 1006, reason = ''): void {
    this.readyState = MockWebSocket.CLOSED;
    this.onclose?.({ code, reason });
  }

  simulateError(): void {
    this.onerror?.({});
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
  // Full jitter: delay = floor(random * cap). Pin it so backoff is deterministic.
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

function createMux(overrides?: Partial<GatewayMuxClientOptions>) {
  const getToken = vi.fn(async () => 'tok');
  const mux = new GatewayMuxClient({
    clientId: 'cid',
    gatewayUrl: 'https://gateway.test.com',
    getToken,
    ...overrides,
  });
  muxes.push(mux);
  return { getToken, mux };
}

function getLatestWs(): MockWebSocket {
  return mockWsInstances.at(-1)!;
}

/** Let `getToken` resolve and the mock socket open. */
async function settle(): Promise<MockWebSocket> {
  await vi.advanceTimersByTimeAsync(1);
  return getLatestWs();
}

async function connectAndReady(mux: GatewayMuxClient): Promise<MockWebSocket> {
  const pending = mux.connect();
  const ws = await settle();
  ws.simulateMessage(READY);
  await pending;
  return ws;
}

const agentEvent = (
  operationId: string,
  id: string,
  type = 'stream_chunk',
  eventOperationId = operationId,
): MuxServerMessage => ({
  event: { data: { id }, operationId: eventOperationId, stepIndex: 0, timestamp: 1, type } as any,
  id,
  operationId,
  type: 'agent_event',
});

describe('GatewayMuxClient', () => {
  describe('connection', () => {
    it('dials /v2/ws with token and clientId, deriving wss from https', async () => {
      const { mux } = createMux();
      mux.connect().catch(() => {});
      const ws = await settle();
      expect(ws.url).toBe('wss://gateway.test.com/v2/ws?token=tok&clientId=cid');
    });

    it('derives ws from http and strips trailing slashes', async () => {
      const { mux } = createMux({ gatewayUrl: 'http://localhost:8787/' });
      mux.connect().catch(() => {});
      const ws = await settle();
      expect(ws.url).toBe('ws://localhost:8787/v2/ws?token=tok&clientId=cid');
    });

    it('awaits getToken before every connect attempt', async () => {
      const { getToken, mux } = createMux();
      mux.subscribe('op-1'); // a live subscription keeps the lazy mux redialing
      const ws = await connectAndReady(mux);
      expect(getToken).toHaveBeenCalledTimes(1);

      ws.simulateClose();
      await vi.advanceTimersByTimeAsync(500); // 0.5 * 1000ms cap
      await settle();
      expect(getToken).toHaveBeenCalledTimes(2);
      expect(mockWsInstances).toHaveLength(2);
    });

    it('sends nothing until ready, then the subscribe for every pending subscription', async () => {
      const { mux } = createMux();
      const sub = mux.subscribe('op-1', { executor: true });
      const onConnected = vi.fn();
      sub.on('connected', onConnected);

      const ws = await settle();
      expect(ws.sent).toHaveLength(0);
      expect(mux.status).toBe('connecting');

      ws.simulateMessage(READY);
      expect(mux.status).toBe('connected');
      expect(ws.messages).toEqual([{ executor: true, operationId: 'op-1', type: 'subscribe' }]);
      expect(onConnected).toHaveBeenCalledOnce();
    });

    it('connect() resolves on ready and is idempotent', async () => {
      const { mux } = createMux();
      const first = mux.connect();
      const second = mux.connect();
      const ws = await settle();
      expect(mockWsInstances).toHaveLength(1);
      ws.simulateMessage(READY);
      await expect(first).resolves.toBeUndefined();
      await expect(second).resolves.toBeUndefined();
      await expect(mux.connect()).resolves.toBeUndefined();
      expect(mockWsInstances).toHaveLength(1);
    });

    it('emits status_changed / connected / disconnected at the mux level', async () => {
      const { mux } = createMux();
      const statuses: string[] = [];
      const onConnected = vi.fn();
      const onDisconnected = vi.fn();
      mux.on('status_changed', (s) => statuses.push(s));
      mux.on('connected', onConnected);
      mux.on('disconnected', onDisconnected);

      await connectAndReady(mux);
      expect(statuses).toEqual(['connecting', 'connected']);
      expect(onConnected).toHaveBeenCalledOnce();

      mux.disconnect();
      expect(statuses).toEqual(['connecting', 'connected', 'disconnected']);
      expect(onDisconnected).toHaveBeenCalledOnce();
      expect(getLatestWs().closedWith?.code).toBe(1000);
    });

    it('does not reconnect after an intentional disconnect', async () => {
      const { mux } = createMux();
      mux.subscribe('op-1');
      await connectAndReady(mux);
      mux.disconnect();
      await vi.advanceTimersByTimeAsync(60_000);
      expect(mockWsInstances).toHaveLength(1);
    });

    it('surfaces a getToken failure as error and retries with backoff', async () => {
      const getToken = vi
        .fn<() => Promise<string>>()
        .mockRejectedValueOnce(new Error('boom'))
        .mockResolvedValue('tok');
      const { mux } = createMux({ getToken });
      const onError = vi.fn();
      const onReconnecting = vi.fn();
      mux.on('error', onError);
      mux.on('reconnecting', onReconnecting);

      mux.connect().catch(() => {});
      await vi.advanceTimersByTimeAsync(1);
      expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: 'boom' }));
      expect(onReconnecting).toHaveBeenCalledWith(500);
      expect(mockWsInstances).toHaveLength(0);

      await vi.advanceTimersByTimeAsync(500);
      await settle();
      expect(mockWsInstances).toHaveLength(1);
    });
  });

  describe('subscribe message shape', () => {
    it('includes lastEventId and executor only when set', async () => {
      const { mux } = createMux();
      const ws = await connectAndReady(mux);

      mux.subscribe('op-a');
      mux.subscribe('op-b', { executor: true, lastEventId: '42' });

      expect(ws.messages).toEqual([
        { operationId: 'op-a', type: 'subscribe' },
        { executor: true, lastEventId: '42', operationId: 'op-b', type: 'subscribe' },
      ]);
    });

    it('sends unsubscribe when the last subscription for an op leaves', async () => {
      const { mux } = createMux();
      const ws = await connectAndReady(mux);
      const a = mux.subscribe('op-1');
      const b = mux.subscribe('op-1');

      a.unsubscribe();
      expect(ws.ofType('unsubscribe')).toHaveLength(0);
      b.unsubscribe();
      expect(ws.ofType('unsubscribe')).toEqual([{ operationId: 'op-1', type: 'unsubscribe' }]);
    });

    it('closes an idle lazy mux after the last subscription ends and redials on the next subscribe', async () => {
      const { mux } = createMux();
      const ws = await connectAndReady(mux);
      const sub = mux.subscribe('op-1');

      sub.unsubscribe();
      expect(ws.ofType('unsubscribe')).toHaveLength(1);
      // The close is deferred a tick so unsubscribe+subscribe reuses the socket.
      expect(ws.closedWith).toBeNull();
      await vi.advanceTimersByTimeAsync(0);
      expect(ws.closedWith).not.toBeNull();
      expect(mux.status).toBe('disconnected');
      await vi.advanceTimersByTimeAsync(60_000);
      expect(mockWsInstances).toHaveLength(1);

      mux.subscribe('op-2');
      const ws2 = await settle();
      expect(mockWsInstances).toHaveLength(2);
      ws2.simulateMessage(READY);
      expect(ws2.ofType('subscribe')).toEqual([{ operationId: 'op-2', type: 'subscribe' }]);
    });

    it('does not redial an idle lazy mux that loses its socket', async () => {
      const { mux } = createMux();
      const ws = await connectAndReady(mux);
      ws.simulateClose();
      await vi.advanceTimersByTimeAsync(60_000);
      expect(mockWsInstances).toHaveLength(1);
      expect(mux.status).toBe('disconnected');
    });

    it('keeps a keepAlive mux up after the last subscription ends', async () => {
      const { mux } = createMux({ keepAlive: true });
      const ws = await connectAndReady(mux);
      mux.subscribe('op-1').unsubscribe();
      expect(ws.ofType('unsubscribe')).toHaveLength(1);
      await vi.advanceTimersByTimeAsync(0);
      expect(ws.closedWith).toBeNull();
      expect(mux.status).toBe('connected');
    });

    it('reuses the socket when a subscribe follows the last unsubscribe in the same tick', async () => {
      const { mux } = createMux();
      const ws = await connectAndReady(mux);
      mux.subscribe('op-1').unsubscribe();
      mux.subscribe('op-2');
      await vi.advanceTimersByTimeAsync(0);
      expect(ws.closedWith).toBeNull();
      expect(mockWsInstances).toHaveLength(1);
      expect(ws.ofType('subscribe').map((m: any) => m.operationId)).toEqual(['op-1', 'op-2']);
    });
  });

  describe('operation id on the envelope', () => {
    it('fills an omitted event.operationId from the envelope', async () => {
      const { mux } = createMux();
      const ws = await connectAndReady(mux);
      const sub = mux.subscribe('op-1');
      const seen: (string | undefined)[] = [];
      sub.on('agent_event', (e) => seen.push(e.operationId));

      const { event, ...envelope } = agentEvent('op-1', '1') as any;
      const { operationId: _omitted, ...eventWithoutOp } = event;
      ws.simulateMessage({ ...envelope, event: eventWithoutOp });

      expect(seen).toEqual(['op-1']);
    });

    it('leaves a mirrored member event pointing at its own operation', async () => {
      const { mux } = createMux();
      const ws = await connectAndReady(mux);
      const sub = mux.subscribe('op-1');
      const seen: (string | undefined)[] = [];
      sub.on('agent_event', (e) => seen.push(e.operationId));

      ws.simulateMessage(agentEvent('op-1', '1', 'stream_chunk', 'op-member'));

      expect(seen).toEqual(['op-member']);
    });

    it('does not treat an omitted id as a foreign terminal', async () => {
      const { mux } = createMux();
      const ws = await connectAndReady(mux);
      const sub = mux.subscribe('op-1');
      const onComplete = vi.fn();
      sub.on('session_complete', onComplete);

      const { event, ...envelope } = agentEvent('op-1', '1', 'agent_runtime_end') as any;
      const { operationId: _omitted, ...eventWithoutOp } = event;
      ws.simulateMessage({ ...envelope, event: eventWithoutOp });

      expect(onComplete).toHaveBeenCalled();
    });
  });

  describe('routing and dedup', () => {
    it('emits replay then live events in arrival order and drops ids ≤ lastSeq', async () => {
      const { mux } = createMux();
      const ws = await connectAndReady(mux);
      const sub = mux.subscribe('op-1');
      const seen: string[] = [];
      const onResume = vi.fn();
      const onComplete = vi.fn();
      sub.on('agent_event', (e) => seen.push(e.data.id));
      sub.on('resume_complete', onResume);
      sub.on('session_complete', onComplete);

      // replay
      ws.simulateMessage(agentEvent('op-1', '1'));
      ws.simulateMessage(agentEvent('op-1', '2'));
      ws.simulateMessage({
        gap: false,
        operationId: 'op-1',
        status: 'running',
        type: 'resume_complete',
      });
      // live, including a duplicate that raced the resubscribe
      ws.simulateMessage(agentEvent('op-1', '3'));
      ws.simulateMessage(agentEvent('op-1', '2'));
      ws.simulateMessage(agentEvent('op-1', '4'));

      expect(seen).toEqual(['1', '2', '3', '4']);
      expect(sub.lastEventId).toBe('4');
      expect(onResume).toHaveBeenCalledWith({ gap: false, pending: undefined, status: 'running' });
      expect(onComplete).not.toHaveBeenCalled();
    });

    it('drops replayed ids at or below the initial lastEventId', async () => {
      const { mux } = createMux();
      const ws = await connectAndReady(mux);
      const sub = mux.subscribe('op-1', { lastEventId: '5' });
      const seen: string[] = [];
      sub.on('agent_event', (e) => seen.push(e.data.id));

      ws.simulateMessage(agentEvent('op-1', '5'));
      ws.simulateMessage(agentEvent('op-1', '6'));
      expect(seen).toEqual(['6']);
    });

    it('routes two subscriptions on one socket by operationId', async () => {
      const { mux } = createMux();
      const ws = await connectAndReady(mux);
      const a = mux.subscribe('op-a');
      const b = mux.subscribe('op-b');
      const seenA: string[] = [];
      const seenB: string[] = [];
      a.on('agent_event', (e) => seenA.push(e.data.id));
      b.on('agent_event', (e) => seenB.push(e.data.id));

      ws.simulateMessage(agentEvent('op-a', '1'));
      ws.simulateMessage(agentEvent('op-b', '1'));
      ws.simulateMessage(agentEvent('op-a', '2'));
      ws.simulateMessage(agentEvent('op-unknown', '9'));

      expect(mockWsInstances).toHaveLength(1);
      expect(seenA).toEqual(['1', '2']);
      expect(seenB).toEqual(['1']);
    });

    it('delivers a tool_execute only to the subscription the hub addressed', async () => {
      const { mux } = createMux();
      const ws = await connectAndReady(mux);
      const executor = mux.subscribe('op-1', { executor: true });
      const viewer = mux.subscribe('op-2');
      const onExecutor = vi.fn();
      const onViewer = vi.fn();
      executor.on('agent_event', onExecutor);
      viewer.on('agent_event', onViewer);

      ws.simulateMessage(agentEvent('op-1', '1', 'tool_execute'));

      expect(onExecutor).toHaveBeenCalledOnce();
      expect(onExecutor.mock.calls[0][0].type).toBe('tool_execute');
      expect(onViewer).not.toHaveBeenCalled();
    });

    it('routes a hub error carrying operationId to that subscription', async () => {
      const { mux } = createMux();
      const ws = await connectAndReady(mux);
      const sub = mux.subscribe('op-1');
      const onSubError = vi.fn();
      const onMuxError = vi.fn();
      sub.on('error', onSubError);
      mux.on('error', onMuxError);

      ws.simulateMessage({
        code: 'not_subscribed',
        message: 'nope',
        operationId: 'op-1',
        type: 'error',
      });
      ws.simulateMessage({ code: 'bad_request', message: 'huh', type: 'error' });

      expect(onSubError).toHaveBeenCalledWith(
        expect.objectContaining({ message: 'not_subscribed: nope' }),
      );
      expect(onMuxError).toHaveBeenCalledWith(
        expect.objectContaining({ message: 'bad_request: huh' }),
      );
    });

    it('surfaces op_lifecycle at the mux level', async () => {
      const { mux } = createMux();
      const ws = await connectAndReady(mux);
      const onLifecycle = vi.fn();
      mux.on('lifecycle', onLifecycle);

      const lifecycle: MuxServerMessage = {
        at: 123,
        meta: { topicId: 'tpc' },
        operationId: 'op-9',
        status: 'running',
        type: 'op_lifecycle',
      };
      ws.simulateMessage(lifecycle);
      expect(onLifecycle).toHaveBeenCalledWith(lifecycle);
    });
  });

  describe('terminal handling', () => {
    const terminalCases: Array<{
      completion: unknown;
      message: MuxServerMessage;
      name: string;
    }> = [
      {
        completion: { source: 'agent_event' },
        message: agentEvent('op-1', '3', 'agent_runtime_end'),
        name: 'own agent_runtime_end',
      },
      {
        completion: { source: 'agent_event' },
        message: agentEvent('op-1', '3', 'error'),
        name: 'own error event',
      },
      {
        completion: { source: 'raw_session_complete' },
        message: { id: '3', operationId: 'op-1', type: 'session_complete' },
        name: 'session_complete',
      },
      {
        completion: { source: 'resume_status', status: 'completed' },
        message: { gap: false, operationId: 'op-1', status: 'completed', type: 'resume_complete' },
        name: 'terminal resume_complete',
      },
      {
        completion: { source: 'status_change', status: 'error' },
        message: { id: '3', operationId: 'op-1', status: 'error', type: 'status_change' },
        name: 'terminal status_change',
      },
    ];

    for (const { completion, message, name } of terminalCases) {
      it(`${name} emits session_complete, then disconnected, and auto-unsubscribes`, async () => {
        const { mux } = createMux();
        const ws = await connectAndReady(mux);
        const sub = mux.subscribe('op-1');
        const order: string[] = [];
        sub.on('agent_event', () => order.push('event'));
        sub.on('session_complete', (c) => {
          order.push('complete');
          expect(c).toEqual(completion);
        });
        sub.on('disconnected', () => order.push('disconnected'));

        ws.simulateMessage(message);

        expect(order.filter((o) => o !== 'event')).toEqual(['complete', 'disconnected']);
        expect(sub.active).toBe(false);
        expect(ws.ofType('unsubscribe')).toEqual([{ operationId: 'op-1', type: 'unsubscribe' }]);
        // Nothing else is delivered to a finished subscription.
        const late = vi.fn();
        sub.on('agent_event', late);
        ws.simulateMessage(agentEvent('op-1', '4'));
        expect(late).not.toHaveBeenCalled();
      });
    }

    it('keeps waiting on resume_complete{pending:true}', async () => {
      const { mux } = createMux();
      const ws = await connectAndReady(mux);
      const sub = mux.subscribe('op-1');
      const onResume = vi.fn();
      const onComplete = vi.fn();
      sub.on('resume_complete', onResume);
      sub.on('session_complete', onComplete);

      ws.simulateMessage({
        gap: false,
        operationId: 'op-1',
        pending: true,
        type: 'resume_complete',
      });
      await vi.advanceTimersByTimeAsync(30_000);

      expect(onResume).toHaveBeenCalledWith({ gap: false, pending: true, status: undefined });
      expect(onComplete).not.toHaveBeenCalled();
      expect(sub.active).toBe(true);
    });

    it('does not end on a running resume_complete or a non-terminal status_change', async () => {
      const { mux } = createMux();
      const ws = await connectAndReady(mux);
      const sub = mux.subscribe('op-1');
      const onStatus = vi.fn();
      sub.on('status_change', onStatus);

      ws.simulateMessage({
        gap: true,
        operationId: 'op-1',
        status: 'running',
        type: 'resume_complete',
      });
      ws.simulateMessage({
        id: '1',
        operationId: 'op-1',
        status: 'waiting_input',
        type: 'status_change',
      });

      expect(onStatus).toHaveBeenCalledWith('waiting_input');
      expect(sub.active).toBe(true);
    });

    it('does NOT end on a mirrored member terminal for a different operationId', async () => {
      const { mux } = createMux();
      const ws = await connectAndReady(mux);
      const sub = mux.subscribe('op-1');
      const events: any[] = [];
      sub.on('agent_event', (e) => events.push(e));

      ws.simulateMessage(agentEvent('op-1', '1', 'agent_runtime_end', 'op-member'));
      expect(events).toHaveLength(1);
      expect(events[0].operationId).toBe('op-member');
      expect(sub.active).toBe(true);

      ws.simulateMessage(agentEvent('op-1', '2', 'agent_runtime_end'));
      expect(sub.active).toBe(false);
    });

    it('subscribe_failed emits auth_failed and ends the subscription', async () => {
      const { mux } = createMux();
      const ws = await connectAndReady(mux);
      const sub = mux.subscribe('op-1');
      const onAuthFailed = vi.fn();
      sub.on('auth_failed', onAuthFailed);

      ws.simulateMessage({ operationId: 'op-1', reason: 'forbidden', type: 'subscribe_failed' });
      expect(onAuthFailed).toHaveBeenCalledWith('forbidden');
      expect(sub.active).toBe(false);
    });

    it('emits input_request and tool_confirmation_request on the subscription', async () => {
      const { mux } = createMux();
      const ws = await connectAndReady(mux);
      const sub = mux.subscribe('op-1');
      const onInput = vi.fn();
      const onConfirm = vi.fn();
      sub.on('input_request', onInput);
      sub.on('tool_confirmation_request', onConfirm);

      ws.simulateMessage({
        id: '1',
        operationId: 'op-1',
        prompt: 'p',
        requestId: 'r',
        type: 'input_request',
      });
      ws.simulateMessage({
        id: '2',
        operationId: 'op-1',
        tool: { name: 'x' },
        toolCallId: 'c',
        type: 'tool_confirmation_request',
      });
      expect(onInput).toHaveBeenCalledWith(expect.objectContaining({ requestId: 'r' }));
      expect(onConfirm).toHaveBeenCalledWith(expect.objectContaining({ toolCallId: 'c' }));

      sub.sendUserInput('r', 'hello');
      sub.sendToolConfirmation('c', true);
      expect(ws.ofType('user_input')).toEqual([
        { content: 'hello', operationId: 'op-1', requestId: 'r', type: 'user_input' },
      ]);
      expect(ws.ofType('tool_confirmation')).toEqual([
        { approved: true, operationId: 'op-1', toolCallId: 'c', type: 'tool_confirmation' },
      ]);
    });
  });

  describe('outbound op messages', () => {
    it('sends tool_result and interrupt with the operationId', async () => {
      const { mux } = createMux();
      const ws = await connectAndReady(mux);
      const sub = mux.subscribe('op-1');

      expect(
        sub.sendToolResult({ content: '{"ok":true}', success: true, toolCallId: 'call_1' }),
      ).toBe(true);
      expect(sub.sendInterrupt()).toBe(true);

      expect(ws.ofType('tool_result')).toEqual([
        {
          content: '{"ok":true}',
          operationId: 'op-1',
          success: true,
          toolCallId: 'call_1',
          type: 'tool_result',
        },
      ]);
      expect(ws.ofType('interrupt')).toEqual([{ operationId: 'op-1', type: 'interrupt' }]);
    });

    it('queues tool_result while disconnected and flushes after resubscribe', async () => {
      const { mux } = createMux();
      const ws = await connectAndReady(mux);
      const sub = mux.subscribe('op-1');
      ws.simulateMessage(agentEvent('op-1', '7'));

      ws.simulateClose();
      expect(sub.sendToolResult({ content: 'late', success: true, toolCallId: 'call_1' })).toBe(
        true,
      );
      expect(sub.sendInterrupt()).toBe(false);

      await vi.advanceTimersByTimeAsync(500);
      const ws2 = await settle();
      expect(ws2.sent).toHaveLength(0);
      ws2.simulateMessage(READY);

      expect(ws2.messages).toEqual([
        { lastEventId: '7', operationId: 'op-1', type: 'subscribe' },
        {
          content: 'late',
          operationId: 'op-1',
          success: true,
          toolCallId: 'call_1',
          type: 'tool_result',
        },
      ]);
    });

    it('hands queued tool results to an owner moving the operation elsewhere', async () => {
      const { mux } = createMux();
      const ws = await connectAndReady(mux);
      const a = mux.subscribe('op-a');
      const b = mux.subscribe('op-b');
      ws.simulateClose();

      a.sendToolResult({ content: 'stale', success: true, toolCallId: 'call_old' });
      await vi.advanceTimersByTimeAsync(121_000);
      a.sendToolResult({ content: 'for a', success: true, toolCallId: 'call_a' });
      b.sendToolResult({ content: 'for b', success: true, toolCallId: 'call_b' });

      // Envelope stripped back to the v1 payload; expired entries are dropped.
      expect(mux.takePendingToolResults('op-a')).toEqual([
        { content: 'for a', success: true, toolCallId: 'call_a' },
      ]);
      // Taken means gone: nothing left for op-a, op-b untouched.
      expect(mux.takePendingToolResults('op-a')).toEqual([]);
      expect(mux.takePendingToolResults('op-b').map((r) => r.toolCallId)).toEqual(['call_b']);
    });

    it('drops queued tool_result older than 120s', async () => {
      const { mux } = createMux();
      const ws = await connectAndReady(mux);
      const sub = mux.subscribe('op-1');

      ws.simulateClose();
      sub.sendToolResult({ content: 'stale', success: true, toolCallId: 'call_old' });
      // Keep the socket down past the TTL, then let it come back.
      await vi.advanceTimersByTimeAsync(500);
      const ws2 = await settle();
      ws2.simulateClose();
      await vi.advanceTimersByTimeAsync(121_000);
      sub.sendToolResult({ content: 'fresh', success: true, toolCallId: 'call_new' });
      await vi.advanceTimersByTimeAsync(30_000);
      const ws3 = await settle();
      ws3.simulateMessage(READY);

      expect(ws3.ofType('tool_result').map((m) => m.toolCallId)).toEqual(['call_new']);
    });

    it('returns false for outbound messages on an ended subscription', async () => {
      const { mux } = createMux();
      await connectAndReady(mux);
      const sub = mux.subscribe('op-1');
      sub.unsubscribe();
      expect(sub.sendToolResult({ content: null, success: false, toolCallId: 'x' })).toBe(false);
      expect(sub.sendInterrupt()).toBe(false);
    });
  });

  describe('reconnection', () => {
    it('resubscribes every live subscription with its own lastEventId after reconnect', async () => {
      const { mux } = createMux();
      const ws = await connectAndReady(mux);
      const a = mux.subscribe('op-a', { executor: true });
      mux.subscribe('op-b');
      const done = mux.subscribe('op-done');
      const statuses: string[] = [];
      const onReconnecting = vi.fn();
      a.on('status_changed', (s) => statuses.push(s));
      a.on('reconnecting', onReconnecting);

      ws.simulateMessage(agentEvent('op-a', '12'));
      ws.simulateMessage(agentEvent('op-b', '3'));
      ws.simulateMessage({ id: '1', operationId: 'op-done', type: 'session_complete' });
      expect(done.active).toBe(false);

      ws.simulateClose();
      expect(statuses).toEqual(['reconnecting']);
      expect(onReconnecting).toHaveBeenCalledWith(500);
      expect(mux.status).toBe('connecting');

      await vi.advanceTimersByTimeAsync(500);
      const ws2 = await settle();
      ws2.simulateMessage(READY);

      expect(ws2.messages).toEqual([
        { executor: true, lastEventId: '12', operationId: 'op-a', type: 'subscribe' },
        { lastEventId: '3', operationId: 'op-b', type: 'subscribe' },
      ]);
      expect(statuses).toEqual(['reconnecting', 'connected']);
    });

    it('backs off exponentially with full jitter, capped at 30s, and resets on ready', async () => {
      const { mux } = createMux();
      const delays: number[] = [];
      mux.on('reconnecting', (d) => delays.push(d));
      mux.subscribe('op-1');
      const ws = await connectAndReady(mux);

      ws.simulateClose();
      for (let i = 0; i < 7; i++) {
        await vi.advanceTimersByTimeAsync(delays.at(-1)!);
        (await settle()).simulateClose();
      }
      // random = 0.5 → half of cap: 1s, 2s, 4s, 8s, 16s, 30s(cap), 30s, 30s
      expect(delays).toEqual([500, 1000, 2000, 4000, 8000, 15_000, 15_000, 15_000]);

      await vi.advanceTimersByTimeAsync(15_000);
      const wsN = await settle();
      wsN.simulateMessage(READY);
      wsN.simulateClose();
      expect(delays.at(-1)).toBe(500);
    });

    it('reconnects immediately on window online while backing off', async () => {
      const { mux } = createMux();
      mux.subscribe('op-1');
      const ws = await connectAndReady(mux);

      ws.simulateClose();
      window.dispatchEvent(new Event('online'));
      await settle();
      expect(mockWsInstances).toHaveLength(2);
    });

    it('reconnects when the tab becomes visible while backing off', async () => {
      const { mux } = createMux();
      mux.subscribe('op-1');
      const ws = await connectAndReady(mux);

      ws.simulateClose();
      document.dispatchEvent(new Event('visibilitychange'));
      await settle();
      expect(mockWsInstances).toHaveLength(2);
    });

    it('redials on window online with zero subscriptions only when keepAlive is set', async () => {
      const { mux: lazy } = createMux();
      const wsLazy = await connectAndReady(lazy);
      wsLazy.simulateClose();
      window.dispatchEvent(new Event('online'));
      await settle();
      // The backoff timer still owns the redial; the immediate path is gated.
      expect(mockWsInstances).toHaveLength(1);
      lazy.disconnect();

      const { mux: eager } = createMux({ keepAlive: true });
      const wsEager = await connectAndReady(eager);
      wsEager.simulateClose();
      window.dispatchEvent(new Event('online'));
      await settle();
      expect(mockWsInstances).toHaveLength(3);
    });

    it('treats 3 missed heartbeat acks as a dead socket and reconnects', async () => {
      const { mux } = createMux();
      mux.subscribe('op-1');
      const ws = await connectAndReady(mux);
      const onReconnecting = vi.fn();
      mux.on('reconnecting', onReconnecting);

      await vi.advanceTimersByTimeAsync(30_000);
      expect(ws.sent.at(-1)).toBe('{"type":"heartbeat"}');
      ws.simulateMessage({ type: 'heartbeat_ack' });
      await vi.advanceTimersByTimeAsync(30_000);
      expect(ws.ofType('heartbeat')).toHaveLength(2);
      // No acks from now on: 3 more heartbeats go unanswered, the 4th tick gives up.
      await vi.advanceTimersByTimeAsync(30_000 * 2);
      expect(ws.ofType('heartbeat')).toHaveLength(4);
      expect(onReconnecting).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(30_000);
      expect(onReconnecting).toHaveBeenCalledOnce();
      expect(ws.closedWith?.code).toBe(1000);
    });

    it('does not reconnect when autoReconnect is false', async () => {
      const { mux } = createMux({ autoReconnect: false });
      const sub = mux.subscribe('op-1');
      const onDisconnected = vi.fn();
      mux.on('disconnected', onDisconnected);
      const statuses: string[] = [];
      sub.on('status_changed', (s) => statuses.push(s));
      const ws = await connectAndReady(mux);

      ws.simulateClose();
      await vi.advanceTimersByTimeAsync(60_000);
      expect(mockWsInstances).toHaveLength(1);
      expect(mux.status).toBe('disconnected');
      expect(onDisconnected).toHaveBeenCalledOnce();
      expect(statuses.at(-1)).toBe('disconnected');
    });
  });

  describe('auth (close code 4401)', () => {
    it('refreshes the token and reconnects immediately', async () => {
      const getToken = vi.fn().mockResolvedValueOnce('expired').mockResolvedValue('fresh');
      const { mux } = createMux({ getToken });
      const onReconnecting = vi.fn();
      mux.on('reconnecting', onReconnecting);
      mux.subscribe('op-1');
      const ws = await connectAndReady(mux);
      expect(ws.url).toContain('token=expired');

      ws.simulateClose(4401, 'auth_expired');
      expect(onReconnecting).toHaveBeenCalledWith(0);
      const ws2 = await settle();
      expect(getToken).toHaveBeenCalledTimes(2);
      expect(ws2.url).toContain('token=fresh');
    });

    it('gives up after 3 consecutive 4401s: auth_failed on every subscription, no more dials', async () => {
      const { getToken, mux } = createMux();
      const a = mux.subscribe('op-a');
      const b = mux.subscribe('op-b');
      const onAuthA = vi.fn();
      const onAuthB = vi.fn();
      const onDisconnected = vi.fn();
      a.on('auth_failed', onAuthA);
      b.on('auth_failed', onAuthB);
      mux.on('disconnected', onDisconnected);

      let ws = await connectAndReady(mux);
      ws.simulateClose(4401, 'auth_failed');
      ws = await settle();
      ws.simulateClose(4401, 'auth_failed');
      ws = await settle();
      ws.simulateClose(4401, 'auth_failed');

      expect(onAuthA).toHaveBeenCalledWith('auth_failed');
      expect(onAuthB).toHaveBeenCalledWith('auth_failed');
      expect(a.active).toBe(false);
      expect(b.active).toBe(false);
      expect(mux.status).toBe('disconnected');
      expect(onDisconnected).toHaveBeenCalledOnce();

      await vi.advanceTimersByTimeAsync(60_000);
      expect(getToken).toHaveBeenCalledTimes(3);
      expect(mockWsInstances).toHaveLength(3);
    });

    it('resets the 4401 counter once a connection reaches ready', async () => {
      const { mux } = createMux();
      const sub = mux.subscribe('op-1');
      const onAuth = vi.fn();
      sub.on('auth_failed', onAuth);

      let ws = await connectAndReady(mux);
      ws.simulateClose(4401);
      ws = await settle();
      ws.simulateClose(4401);
      ws = await settle();
      ws.simulateMessage(READY);
      ws.simulateClose(4401);
      ws = await settle();
      ws.simulateClose(4401);

      expect(onAuth).not.toHaveBeenCalled();
      expect(sub.active).toBe(true);
    });
  });

  describe('unavailable (fallback to v1)', () => {
    it('gives up after maxDialFailures dials that never reach ready', async () => {
      const { getToken, mux } = createMux();
      const sub = mux.subscribe('op-1');
      const onUnavailable = vi.fn();
      mux.on('unavailable', onUnavailable);

      let ws = await settle();
      ws.simulateClose(1006);
      await vi.advanceTimersByTimeAsync(500); // attempt 1: 0.5 * 1000 cap
      ws = await settle();
      ws.simulateClose(1006);
      await vi.advanceTimersByTimeAsync(1000); // attempt 2: 0.5 * 2000 cap
      ws = await settle();
      expect(onUnavailable).not.toHaveBeenCalled();
      ws.simulateClose(1006);

      expect(onUnavailable).toHaveBeenCalledOnce();
      expect(mux.isUnavailable).toBe(true);
      // The owner re-establishes the run on v1, so the subscription must not be
      // ended here — a terminal signal would complete the operation instead.
      expect(sub.active).toBe(true);

      await vi.advanceTimersByTimeAsync(60_000);
      expect(mockWsInstances).toHaveLength(3);
      expect(getToken).toHaveBeenCalledTimes(3);
    });

    it('gives up when the token cannot be minted at all', async () => {
      const getToken = vi.fn().mockRejectedValue(new Error('404 issueGatewayUserToken'));
      const { mux } = createMux({ getToken });
      mux.on('error', () => {});
      const onUnavailable = vi.fn();
      mux.on('unavailable', onUnavailable);
      mux.subscribe('op-1');

      await vi.advanceTimersByTimeAsync(1);
      await vi.advanceTimersByTimeAsync(500);
      await vi.advanceTimersByTimeAsync(1000);

      expect(onUnavailable).toHaveBeenCalledOnce();
      expect(mockWsInstances).toHaveLength(0);
    });

    it('turns a terminal 4401 into unavailable instead of failing the runs', async () => {
      const { mux } = createMux();
      const sub = mux.subscribe('op-1');
      const onAuthFailed = vi.fn();
      const onUnavailable = vi.fn();
      sub.on('auth_failed', onAuthFailed);
      mux.on('unavailable', onUnavailable);

      let ws = await connectAndReady(mux);
      ws.simulateClose(4401, 'auth_failed');
      ws = await settle();
      ws.simulateClose(4401, 'auth_failed');
      ws = await settle();
      ws.simulateClose(4401, 'auth_failed');

      expect(onUnavailable).toHaveBeenCalledWith('auth_failed');
      expect(onAuthFailed).not.toHaveBeenCalled();
      expect(sub.active).toBe(true);
    });

    it('keeps retrying forever when nothing listens for unavailable', async () => {
      const { mux } = createMux();
      mux.subscribe('op-1');

      let ws = await settle();
      ws.simulateClose(1006);
      await vi.advanceTimersByTimeAsync(500);
      ws = await settle();
      ws.simulateClose(1006);
      await vi.advanceTimersByTimeAsync(1000);
      ws = await settle();
      ws.simulateClose(1006);
      await vi.advanceTimersByTimeAsync(2000);
      await settle();

      expect(mux.isUnavailable).toBe(false);
      expect(mockWsInstances).toHaveLength(4);
    });

    it('does not spend the budget on a healthy socket that drops', async () => {
      const { mux } = createMux();
      const onUnavailable = vi.fn();
      mux.on('unavailable', onUnavailable);
      mux.subscribe('op-1');

      // A working connection that later drops is a network event, not evidence
      // that this deployment cannot serve v2.
      let ws = await connectAndReady(mux);
      ws.simulateClose(1006);
      await vi.advanceTimersByTimeAsync(500);
      ws = await settle();
      ws.simulateClose(1006);
      await vi.advanceTimersByTimeAsync(1000);
      ws = await settle();
      ws.simulateClose(1006);
      expect(onUnavailable).not.toHaveBeenCalled();

      // Three dials that never reached `ready` do spend it.
      await vi.advanceTimersByTimeAsync(2000);
      ws = await settle();
      ws.simulateClose(1006);
      expect(onUnavailable).toHaveBeenCalledOnce();
    });

    it('counts token failures that follow a healthy socket', async () => {
      // The server can lose `issueGatewayUserToken` under the client (a bundle
      // deployed ahead of its server). Minting is part of the dial, so those
      // attempts have to spend the budget like any other failed dial.
      const getToken = vi
        .fn()
        .mockResolvedValueOnce('tok')
        .mockRejectedValue(new Error('404 issueGatewayUserToken'));
      const { mux } = createMux({ getToken });
      mux.on('error', () => {});
      const onUnavailable = vi.fn();
      mux.on('unavailable', onUnavailable);
      mux.subscribe('op-1');

      const ws = await connectAndReady(mux);
      ws.simulateClose(1006);
      await vi.advanceTimersByTimeAsync(500);
      await vi.advanceTimersByTimeAsync(1000);
      expect(onUnavailable).not.toHaveBeenCalled();

      await vi.advanceTimersByTimeAsync(2000);
      expect(onUnavailable).toHaveBeenCalledOnce();
    });

    it('does not spend the budget on token refreshes', async () => {
      const { mux } = createMux();
      const onUnavailable = vi.fn();
      mux.on('unavailable', onUnavailable);
      mux.subscribe('op-1');

      // Two 4401 refreshes (their own budget) then one ordinary failure must
      // not add up to the dial budget.
      let ws = await settle();
      ws.simulateClose(4401);
      ws = await settle();
      ws.simulateClose(4401);
      ws = await settle();
      ws.simulateClose(1006);

      expect(onUnavailable).not.toHaveBeenCalled();
    });

    it('rejects connect() once unavailable', async () => {
      const { mux } = createMux();
      mux.on('unavailable', () => {});
      mux.subscribe('op-1');

      let ws = await settle();
      ws.simulateClose(1006);
      await vi.advanceTimersByTimeAsync(500);
      ws = await settle();
      ws.simulateClose(1006);
      await vi.advanceTimersByTimeAsync(1000);
      ws = await settle();
      ws.simulateClose(1006);

      await expect(mux.connect()).rejects.toThrow('unavailable');
    });
  });
});

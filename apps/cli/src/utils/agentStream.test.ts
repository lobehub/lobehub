import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { AgentStreamEvent } from './agentStream';
import { replayAgentEvents, streamAgentEventsViaWebSocket as streamImpl } from './agentStream';
import type { AgentHistoryPage, AgentStreamAuth } from './agentStreamTransport';

type StreamOptions = Parameters<typeof streamImpl>[0];

/** Server journal backing the stream; the socket only carries wake-ups. */
let journal: Array<AgentStreamEvent & { id: string }>;

const readHistory = async (cursor: string): Promise<AgentHistoryPage> => {
  const after = Number(cursor.split('-')[0]);
  const events = journal.filter((event) => Number(event.id.split('-')[0]) > after);
  return { available: true, events, hasMore: false, nextCursor: events.at(-1)?.id ?? cursor };
};

const testAuth: AgentStreamAuth = {
  serverUrl: 'https://server.test',
  token: 'test-token',
  tokenType: 'jwt',
};

const streamAgentEventsViaWebSocket = (
  options: Partial<StreamOptions> & Pick<StreamOptions, 'gatewayUrl' | 'operationId'>,
) =>
  streamImpl({
    getAuth: async () => testAuth,
    maxRetries: 0,
    readHistory,
    ...options,
  });

/** Append an event to the journal and notify over the gateway socket. */
const emit = (event: Record<string, unknown>) => {
  const id = `${journal.length + 1}-0`;
  journal.push({ operationId: 'op-1', stepIndex: 0, timestamp: 0, ...event, id } as any);
  capturedWs!.simulateMessage({ id, type: 'agent_event' });
};

vi.mock('./logger', () => ({
  log: {
    debug: vi.fn(),
    error: vi.fn(),
    heartbeat: vi.fn(),
    info: vi.fn(),
    toolCall: vi.fn(),
    toolResult: vi.fn(),
  },
}));

// ── WebSocket stream tests ──────────────────────────────

let capturedWs: MockWebSocket | undefined;

class MockWebSocket {
  static OPEN = 1;
  static CONNECTING = 0;
  static CLOSED = 3;

  readyState = MockWebSocket.CONNECTING;
  onopen: ((ev: any) => void) | null = null;
  onmessage: ((ev: any) => void) | null = null;
  onerror: ((ev: any) => void) | null = null;
  onclose: ((ev: any) => void) | null = null;

  sent: string[] = [];
  private autoAuthSuccess = true;

  constructor(
    public url: string,
    autoAuth = true,
  ) {
    this.autoAuthSuccess = autoAuth;
    capturedWs = this; // eslint-disable-line @typescript-eslint/no-this-alias
    // Trigger onopen on next microtask (after handlers are assigned)
    queueMicrotask(() => {
      this.readyState = MockWebSocket.OPEN;
      this.onopen?.({ type: 'open' });
    });
  }

  send(data: string) {
    this.sent.push(data);
    const msg = JSON.parse(data);

    if (msg.type === 'auth' && this.autoAuthSuccess) {
      queueMicrotask(() => {
        this.onmessage?.({ data: JSON.stringify({ type: 'auth_success' }) });
      });
    }
  }

  close() {
    this.readyState = MockWebSocket.CLOSED;
    // Async like real WebSocket — fires after current microtask
    queueMicrotask(() => this.onclose?.({ code: 1000, reason: '' }));
  }

  simulateMessage(msg: Record<string, unknown>) {
    this.onmessage?.({ data: JSON.stringify(msg) });
  }
}

describe('streamAgentEventsViaWebSocket', () => {
  let stdoutSpy: ReturnType<typeof vi.spyOn>;
  let consoleSpy: ReturnType<typeof vi.spyOn>;
  const originalWebSocket = globalThis.WebSocket;

  beforeEach(() => {
    capturedWs = undefined;
    journal = [];
    stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    (globalThis as any).WebSocket = MockWebSocket;
  });

  afterEach(() => {
    stdoutSpy.mockRestore();
    consoleSpy.mockRestore();
    globalThis.WebSocket = originalWebSocket;
  });

  /** Wait for microtasks + short delay so WS open/auth cycle completes */
  const flush = () => new Promise((r) => setTimeout(r, 20));

  const end = (data: Record<string, unknown> = {}) =>
    emit({ data: { reason: 'done', ...data }, type: 'agent_runtime_end' });

  it('should connect, authenticate with fresh credentials, and send resume', async () => {
    const promise = streamAgentEventsViaWebSocket({
      gatewayUrl: 'https://gw.test.com',
      operationId: 'op-1',
    });

    await flush();

    const ws = capturedWs!;
    expect(ws.sent.map((s) => JSON.parse(s))).toEqual([
      { serverUrl: 'https://server.test', token: 'test-token', tokenType: 'jwt', type: 'auth' },
      { lastEventId: '', type: 'resume' },
    ]);

    end();
    await promise;
  });

  it('should send tokenType=apiKey and serverUrl when the caller uses an API key', async () => {
    const promise = streamAgentEventsViaWebSocket({
      gatewayUrl: 'https://gw.test.com',
      // `getAgentStreamAuthInfo` also returns HTTP headers; they must not reach the gateway.
      getAuth: async () =>
        ({
          headers: { 'X-API-Key': 'lh_sk_abc' },
          serverUrl: 'https://app.lobehub.com',
          token: 'lh_sk_abc',
          tokenType: 'apiKey',
        }) as AgentStreamAuth,
      operationId: 'op-1',
    });

    await flush();

    const ws = capturedWs!;
    // serverUrl is forwarded so the gateway can call back to /api/v1/users/me
    // to verify the API key.
    expect(ws.sent.map((s) => JSON.parse(s))[0]).toEqual({
      serverUrl: 'https://app.lobehub.com',
      token: 'lh_sk_abc',
      tokenType: 'apiKey',
      type: 'auth',
    });

    end();
    await promise;
  });

  it('should render journal events woken by agent_event notifications', async () => {
    const promise = streamAgentEventsViaWebSocket({
      gatewayUrl: 'https://gw.test.com',
      operationId: 'op-1',
    });

    await flush();

    emit({ data: null, type: 'step_start' });
    emit({ data: { chunkType: 'text', content: 'Hello WS!' }, type: 'stream_chunk' });
    end({ stepCount: 1 });

    await promise;
    expect(stdoutSpy).toHaveBeenCalledWith('Hello WS!');
  });

  it('should output JSON when json option is set', async () => {
    const promise = streamAgentEventsViaWebSocket({
      gatewayUrl: 'https://gw.test.com',
      json: true,
      operationId: 'op-1',
    });

    await flush();

    emit({ data: null, type: 'agent_runtime_init' });
    end({ stepCount: 1 });

    await promise;

    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('"agent_runtime_init"'));
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('"agent_runtime_end"'));
  });

  it('should reject on auth failure', async () => {
    // Override mock to return auth_failed instead of auth_success
    (globalThis as any).WebSocket = class extends MockWebSocket {
      constructor(url: string) {
        super(url, false); // disable auto auth_success
        capturedWs = this; // eslint-disable-line @typescript-eslint/no-this-alias
      }

      override send(data: string) {
        this.sent.push(data);
        const msg = JSON.parse(data);
        if (msg.type === 'auth') {
          queueMicrotask(() => {
            this.onmessage?.({
              data: JSON.stringify({ reason: 'invalid token', type: 'auth_failed' }),
            });
          });
        }
      }
    };

    await expect(
      streamAgentEventsViaWebSocket({
        gatewayUrl: 'https://gw.test.com',
        operationId: 'op-1',
      }),
    ).rejects.toThrow('Gateway auth failed');
  });

  it('should reject once reconnects are exhausted after onerror', async () => {
    const promise = streamAgentEventsViaWebSocket({
      gatewayUrl: 'https://gw.test.com',
      operationId: 'op-1',
    });

    await flush();
    capturedWs!.onerror?.({ message: 'socket exploded', type: 'error' });

    await expect(promise).rejects.toThrow('Agent gateway WebSocket failed');
  });

  it('should reject once reconnects are exhausted after the socket closes', async () => {
    const promise = streamAgentEventsViaWebSocket({
      gatewayUrl: 'https://gw.test.com',
      operationId: 'op-1',
    });

    await flush();
    capturedWs!.readyState = MockWebSocket.CLOSED;
    capturedWs!.onclose?.({ code: 1011, reason: 'gateway shutdown', type: 'close' });

    await expect(promise).rejects.toThrow(
      'Agent gateway WebSocket closed before completion (code 1011: gateway shutdown)',
    );
  });

  it('should resolve from the journal terminal on session_complete', async () => {
    const promise = streamAgentEventsViaWebSocket({
      gatewayUrl: 'https://gw.test.com',
      operationId: 'op-1',
    });

    await flush();
    journal.push({
      data: { reason: 'done' },
      id: '1-0',
      operationId: 'op-1',
      stepIndex: 0,
      timestamp: 0,
      type: 'agent_runtime_end',
    });
    capturedWs!.simulateMessage({ id: '1', summary: 'All done', type: 'session_complete' });

    await expect(promise).resolves.toEqual(expect.objectContaining({ kind: 'completed' }));
  });

  it('should ignore heartbeat_ack messages', async () => {
    const promise = streamAgentEventsViaWebSocket({
      gatewayUrl: 'https://gw.test.com',
      operationId: 'op-1',
    });

    await flush();

    capturedWs!.simulateMessage({ type: 'heartbeat_ack' });
    expect(stdoutSpy).not.toHaveBeenCalled();

    end();
    await promise;
  });

  it('should construct correct WebSocket URL from HTTPS gateway URL', async () => {
    const promise = streamAgentEventsViaWebSocket({
      gatewayUrl: 'https://agent-gateway.lobehub.com',
      operationId: 'op-123',
    });

    await flush();
    expect(capturedWs!.url).toBe('wss://agent-gateway.lobehub.com/ws?operationId=op-123');

    journal.push({
      data: { reason: 'done' },
      id: '1-0',
      operationId: 'op-123',
      stepIndex: 0,
      timestamp: 0,
      type: 'agent_runtime_end',
    });
    capturedWs!.simulateMessage({ type: 'session_complete' });
    await promise;
  });

  it('should render a multi-step agent run with tool calls', async () => {
    const promise = streamAgentEventsViaWebSocket({
      gatewayUrl: 'https://gw.test.com',
      operationId: 'op-1',
      verbose: true,
    });

    await flush();
    const { log } = await import('./logger');

    // Step 1: thinking + text + tool call
    emit({ data: null, type: 'agent_runtime_init' });
    emit({ data: null, type: 'step_start' });
    emit({ data: { chunkType: 'reasoning', reasoning: 'Let me search...' }, type: 'stream_chunk' });
    emit({ data: { chunkType: 'text', content: 'Searching for news.' }, type: 'stream_chunk' });
    emit({ data: { toolCalling: { apiName: 'search', id: 'tc-1' } }, type: 'tool_start' });
    emit({ data: null, type: 'stream_end' });
    emit({ data: { stepIndex: 0 }, type: 'step_complete' });

    // Step 2: tool result + final text
    emit({ data: null, stepIndex: 1, type: 'step_start' });
    emit({
      data: {
        isSuccess: true,
        payload: { toolCalling: { id: 'tc-1' } },
        result: { content: 'Results...' },
      },
      stepIndex: 1,
      type: 'tool_end',
    });
    emit({
      data: { chunkType: 'text', content: 'Here are the results.' },
      stepIndex: 1,
      type: 'stream_chunk',
    });
    end({ cost: { total: 0.05 }, stepCount: 2, usage: { total_tokens: 500 } });

    await promise;

    // Verify reasoning was rendered (dim)
    expect(stdoutSpy).toHaveBeenCalledWith(expect.stringContaining('Let me search...'));
    // Verify text chunks
    expect(stdoutSpy).toHaveBeenCalledWith('Searching for news.');
    expect(stdoutSpy).toHaveBeenCalledWith('Here are the results.');
    // Verify tool call was logged
    expect(log.toolCall).toHaveBeenCalledWith('search', 'tc-1', undefined);
    // Verify tool result was logged
    expect(log.toolResult).toHaveBeenCalled();
    // Verify finish line
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Agent finished'));
  });
});

describe('renderEvent tool_end', () => {
  const toolEnd = (result: Record<string, unknown>) =>
    [
      {
        data: {
          executionTime: 120,
          isSuccess: true,
          payload: { toolCalling: { apiName: 'search', id: 'tc-1', identifier: 'web' } },
          result,
        },
        type: 'tool_end',
      },
    ] as any;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('prints the result body under --verbose', async () => {
    const { log } = await import('./logger');
    replayAgentEvents(toolEnd({ content: 'the body' }), { verbose: true });

    expect(log.toolResult).toHaveBeenCalledWith('tc-1', true, 'the body');
  });

  it('falls back to the timing when the transport dropped the body', async () => {
    const { log } = await import('./logger');
    // The gateway WS projects `tool_end` — the body arrives with the message.
    replayAgentEvents(toolEnd({ success: true }), { verbose: true });

    expect(log.toolResult).toHaveBeenCalledWith('tc-1', true, ' 120ms');
  });
});

describe('run outcome of the live stream (#19543 #19613 #19615)', () => {
  let stdoutSpy: ReturnType<typeof vi.spyOn>;
  let consoleSpy: ReturnType<typeof vi.spyOn>;
  let fetchSpy: ReturnType<typeof vi.spyOn>;
  const originalWebSocket = globalThis.WebSocket;
  const flush = () => new Promise((r) => setTimeout(r, 20));
  const printed = () => consoleSpy.mock.calls.map((c) => String(c[0])).join('\n');

  beforeEach(() => {
    capturedWs = undefined;
    journal = [];
    stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    fetchSpy = vi.spyOn(globalThis, 'fetch');
    (globalThis as any).WebSocket = MockWebSocket;
  });

  afterEach(() => {
    vi.useRealTimers();
    stdoutSpy.mockRestore();
    consoleSpy.mockRestore();
    fetchSpy.mockRestore();
    globalThis.WebSocket = originalWebSocket;
  });

  const endEvent = (reason: string) => ({
    data: { reason, stepCount: 2 },
    operationId: 'op-1',
    stepIndex: 1,
    timestamp: Date.now(),
    type: 'agent_runtime_end',
  });
  const emitEnd = (reason: string) => {
    const { operationId: _, ...event } = endEvent(reason);
    emit(event);
  };

  describe.each([
    ['done', 'completed', 'Agent finished'],
    ['waiting_for_human', 'waiting_for_human', 'Agent paused: waiting for human approval'],
    ['error', 'failed', 'Agent failed'],
    ['interrupted', 'interrupted', 'Agent interrupted'],
  ])('agent_runtime_end reason=%s', (reason, kind, label) => {
    it(`WebSocket resolves ${kind} and prints "${label}"`, async () => {
      const promise = streamAgentEventsViaWebSocket({
        gatewayUrl: 'https://gw.test.com',
        operationId: 'op-1',
      });
      await flush();
      emitEnd(reason);

      await expect(promise).resolves.toEqual(expect.objectContaining({ kind, status: reason }));
      expect(printed()).toContain(label);
      if (reason !== 'done') expect(printed()).not.toContain('Agent finished');
    });
  });

  it('resolves an error event as a failed outcome instead of exiting the process', async () => {
    const promise = streamAgentEventsViaWebSocket({
      gatewayUrl: 'https://gw.test.com',
      operationId: 'op-1',
    });
    await flush();
    emit({ data: { message: 'boom' }, type: 'error' });

    await expect(promise).resolves.toEqual({ error: 'boom', kind: 'failed', status: 'error' });
  });

  describe('replayAgentEvents outcome', () => {
    it.each([
      ['done', 'completed'],
      ['error', 'failed'],
      ['interrupted', 'interrupted'],
      ['waiting_for_human', 'waiting_for_human'],
    ])('returns %s → %s from the recorded end event, in --json mode too', (reason, kind) => {
      const events = [endEvent(reason)] as any;
      expect(replayAgentEvents(events)).toEqual(expect.objectContaining({ kind, status: reason }));
      expect(replayAgentEvents(events, { json: true })).toEqual(
        expect.objectContaining({ kind, status: reason }),
      );
    });

    it('returns a failed outcome for a recorded error event', () => {
      const events = [{ data: { message: 'boom' }, type: 'error' }] as any;
      expect(replayAgentEvents(events)).toEqual({ error: 'boom', kind: 'failed', status: 'error' });
      expect(replayAgentEvents(events, { json: true })).toEqual({
        error: 'boom',
        kind: 'failed',
        status: 'error',
      });
    });

    it('returns undefined for a recording without a terminal event', () => {
      expect(replayAgentEvents([{ data: {}, type: 'stream_start' }] as any)).toBeUndefined();
    });
  });

  it('a quiet stream asks onStall, keeps waiting while active, and fails when the run ended without a journal terminal', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] });
    const onStall = vi
      .fn()
      .mockResolvedValueOnce(undefined) // still running → keep streaming
      .mockResolvedValueOnce({ kind: 'completed', status: 'done' });

    const promise = streamAgentEventsViaWebSocket({
      gatewayUrl: 'https://gw.test.com',
      onStall,
      operationId: 'op-1',
      stallTimeoutMs: 1000,
    });
    const settled = vi.fn();
    promise.then(settled, settled);
    const failure = expect(promise).rejects.toMatchObject({ name: 'AgentStreamHistoryError' });

    await vi.advanceTimersByTimeAsync(1000);
    expect(onStall).toHaveBeenCalledTimes(1);
    expect(settled).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1000);
    await failure;
    expect(onStall).toHaveBeenCalledTimes(2);
    expect(printed()).not.toContain('Agent finished');
  });

  it('real stream progress restarts the quiet window, so a slow healthy run is not probed', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] });
    const onStall = vi.fn();
    const promise = streamAgentEventsViaWebSocket({
      gatewayUrl: 'https://gw.test.com',
      onStall,
      operationId: 'op-1',
      stallTimeoutMs: 1000,
    });
    await vi.advanceTimersByTimeAsync(0);

    for (let i = 0; i < 10; i++) {
      await vi.advanceTimersByTimeAsync(700);
      emit({ data: {}, type: 'step_complete' });
    }
    expect(onStall).not.toHaveBeenCalled();

    emitEnd('done');
    await expect(promise).resolves.toEqual(expect.objectContaining({ kind: 'completed' }));
  });

  it('does not let the heartbeat interval hold the process open', async () => {
    const unref = vi.fn();
    const realSetInterval = globalThis.setInterval;
    const intervalSpy = vi.spyOn(globalThis, 'setInterval').mockImplementation(((
      fn: any,
      ms: any,
    ) => {
      const handle = realSetInterval(fn, ms);
      const original = handle.unref.bind(handle);
      handle.unref = () => {
        unref();
        return original();
      };
      return handle;
    }) as any);

    const promise = streamAgentEventsViaWebSocket({
      gatewayUrl: 'https://gw.test.com',
      operationId: 'op-1',
    });
    await flush();
    expect(unref).toHaveBeenCalled();

    emitEnd('done');
    await promise;
    intervalSpy.mockRestore();
  });
});

describe('--json prints exactly one array, even when no event arrived', () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;
  let consoleSpy: ReturnType<typeof vi.spyOn>;
  const originalWebSocket = globalThis.WebSocket;
  const flush = () => new Promise((r) => setTimeout(r, 20));
  /** Every stdout line written via console.log, parsed — must be exactly `[[]]`. */
  const jsonOutputs = () => consoleSpy.mock.calls.map((c) => JSON.parse(String(c[0])));

  beforeEach(() => {
    capturedWs = undefined;
    journal = [];
    fetchSpy = vi.spyOn(globalThis, 'fetch');
    consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    (globalThis as any).WebSocket = MockWebSocket;
  });

  afterEach(() => {
    fetchSpy.mockRestore();
    consoleSpy.mockRestore();
    globalThis.WebSocket = originalWebSocket;
  });

  it('WebSocket auth failure before any event prints [] once', async () => {
    (globalThis as any).WebSocket = class extends MockWebSocket {
      constructor(url: string) {
        super(url, false);
      }

      override send(data: string) {
        this.sent.push(data);
        if (JSON.parse(data).type === 'auth') {
          queueMicrotask(() =>
            this.onmessage?.({ data: JSON.stringify({ reason: 'bad', type: 'auth_failed' }) }),
          );
        }
      }
    };

    await expect(
      streamAgentEventsViaWebSocket({
        gatewayUrl: 'https://gw.test.com',
        json: true,
        operationId: 'op-1',
      }),
    ).rejects.toThrow('Gateway auth failed');
    await flush(); // the close that follows must not print a second array
    expect(jsonOutputs()).toEqual([[]]);
  });

  it('an expired journal before any event prints [] once', async () => {
    await expect(
      streamAgentEventsViaWebSocket({
        gatewayUrl: 'https://gw.test.com',
        json: true,
        operationId: 'op-1',
        readHistory: async () => ({
          available: false,
          events: [],
          hasMore: false,
          nextCursor: '0',
        }),
      }),
    ).rejects.toMatchObject({ name: 'AgentStreamHistoryError' });
    await flush();
    expect(jsonOutputs()).toEqual([[]]);
  });
});

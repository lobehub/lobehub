import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { streamAgentEvents, streamAgentEventsViaWebSocket } from './agentStream';

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

function createSSEStream(events: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  const payload = events.join('');

  return new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(payload));
      controller.close();
    },
  });
}

/** Create a stream that delivers content in separate chunks to simulate network splitting */
function createChunkedSSEStream(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();

  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(encoder.encode(chunk));
      }
      controller.close();
    },
  });
}

function sseMessage(type: string, data: Record<string, any>): string {
  return `event:${type}\ndata:${JSON.stringify(data)}\n\n`;
}

describe('streamAgentEvents', () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;
  let stdoutSpy: ReturnType<typeof vi.spyOn>;
  let consoleSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, 'fetch');
    stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    fetchSpy.mockRestore();
    stdoutSpy.mockRestore();
    consoleSpy.mockRestore();
  });

  it('should render text stream chunks', async () => {
    const body = createSSEStream([
      sseMessage('data', {
        data: null,
        operationId: 'op1',
        stepIndex: 0,
        timestamp: Date.now(),
        type: 'agent_runtime_init',
      }),
      sseMessage('data', {
        data: null,
        operationId: 'op1',
        stepIndex: 0,
        timestamp: Date.now(),
        type: 'step_start',
      }),
      sseMessage('data', {
        data: { chunkType: 'text', content: 'Hello ' },
        operationId: 'op1',
        stepIndex: 0,
        timestamp: Date.now(),
        type: 'stream_chunk',
      }),
      sseMessage('data', {
        data: { chunkType: 'text', content: 'world!' },
        operationId: 'op1',
        stepIndex: 0,
        timestamp: Date.now(),
        type: 'stream_chunk',
      }),
      sseMessage('data', {
        data: { stepCount: 1, usage: { total_tokens: 100 } },
        operationId: 'op1',
        stepIndex: 0,
        timestamp: Date.now(),
        type: 'agent_runtime_end',
      }),
    ]);

    fetchSpy.mockResolvedValue(new Response(body, { status: 200 }));

    await streamAgentEvents('https://example.com/stream', {});

    expect(stdoutSpy).toHaveBeenCalledWith('Hello ');
    expect(stdoutSpy).toHaveBeenCalledWith('world!');
  });

  it('should output JSON when json option is true', async () => {
    const events = [
      {
        data: null,
        operationId: 'op1',
        stepIndex: 0,
        timestamp: 1000,
        type: 'agent_runtime_init',
      },
      {
        data: { stepCount: 1 },
        operationId: 'op1',
        stepIndex: 0,
        timestamp: 2000,
        type: 'agent_runtime_end',
      },
    ];

    const body = createSSEStream(events.map((e) => sseMessage('data', e)));
    fetchSpy.mockResolvedValue(new Response(body, { status: 200 }));

    await streamAgentEvents('https://example.com/stream', {}, { json: true });

    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('"agent_runtime_init"'));
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('"agent_runtime_end"'));
  });

  it('should handle heartbeat events', async () => {
    const { log } = await import('./logger');
    const body = createSSEStream([
      `event:heartbeat\ndata:{}\n\n`,
      sseMessage('data', {
        data: null,
        operationId: 'op1',
        stepIndex: 0,
        timestamp: Date.now(),
        type: 'agent_runtime_end',
      }),
    ]);

    fetchSpy.mockResolvedValue(new Response(body, { status: 200 }));

    await streamAgentEvents('https://example.com/stream', {});

    expect(log.heartbeat).toHaveBeenCalled();
  });

  it('should preserve SSE frame state across read boundaries', async () => {
    const endEvent = JSON.stringify({
      data: { stepCount: 1 },
      operationId: 'op1',
      stepIndex: 0,
      timestamp: Date.now(),
      type: 'agent_runtime_end',
    });

    // Split SSE message across two chunks: first chunk has event: + data:,
    // second chunk has the terminating blank line.
    const body = createChunkedSSEStream([`event:data\ndata:${endEvent}\n`, `\n`]);

    fetchSpy.mockResolvedValue(new Response(body, { status: 200 }));

    await streamAgentEvents('https://example.com/stream', {});

    // If frame state was lost the event would be silently dropped,
    // and the stream would end without printing the finish line.
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Agent finished'));
  });

  it('should exit on HTTP error', async () => {
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {
      throw new Error('process.exit');
    }) as any);
    const { log } = await import('./logger');

    fetchSpy.mockResolvedValue(new Response('Not Found', { status: 404 }));

    await expect(streamAgentEvents('https://example.com/stream', {})).rejects.toThrow(
      'process.exit',
    );

    expect(log.error).toHaveBeenCalledWith(expect.stringContaining('404'));
    expect(exitSpy).toHaveBeenCalledWith(1);

    exitSpy.mockRestore();
  });
});

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

  it('should connect, authenticate, and send resume', async () => {
    const promise = streamAgentEventsViaWebSocket({
      gatewayUrl: 'https://gw.test.com',
      operationId: 'op-1',
      token: 'test-token',
    });

    await flush();

    const ws = capturedWs!;
    expect(ws.sent.map((s) => JSON.parse(s))).toEqual([
      { token: 'test-token', type: 'auth' },
      { lastEventId: '', type: 'resume' },
    ]);

    ws.simulateMessage({ id: '1', type: 'session_complete' });
    await promise;
  });

  it('should render agent_event messages using existing renderEvent', async () => {
    const promise = streamAgentEventsViaWebSocket({
      gatewayUrl: 'https://gw.test.com',
      operationId: 'op-1',
      token: 'test-token',
    });

    await flush();
    const ws = capturedWs!;

    ws.simulateMessage({
      event: { data: null, operationId: 'op-1', stepIndex: 0, timestamp: 1, type: 'step_start' },
      id: '1',
      type: 'agent_event',
    });
    ws.simulateMessage({
      event: {
        data: { chunkType: 'text', content: 'Hello WS!' },
        operationId: 'op-1',
        stepIndex: 0,
        timestamp: 2,
        type: 'stream_chunk',
      },
      id: '2',
      type: 'agent_event',
    });
    ws.simulateMessage({
      event: {
        data: { stepCount: 1 },
        operationId: 'op-1',
        stepIndex: 0,
        timestamp: 3,
        type: 'agent_runtime_end',
      },
      id: '3',
      type: 'agent_event',
    });

    await promise;
    expect(stdoutSpy).toHaveBeenCalledWith('Hello WS!');
  });

  it('should output JSON when json option is set', async () => {
    const promise = streamAgentEventsViaWebSocket({
      gatewayUrl: 'https://gw.test.com',
      json: true,
      operationId: 'op-1',
      token: 'test-token',
    });

    await flush();
    const ws = capturedWs!;

    ws.simulateMessage({
      event: {
        data: null,
        operationId: 'op-1',
        stepIndex: 0,
        timestamp: 1,
        type: 'agent_runtime_init',
      },
      id: '1',
      type: 'agent_event',
    });
    ws.simulateMessage({
      event: {
        data: { stepCount: 1 },
        operationId: 'op-1',
        stepIndex: 0,
        timestamp: 2,
        type: 'agent_runtime_end',
      },
      id: '2',
      type: 'agent_event',
    });

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
        token: 'bad-token',
      }),
    ).rejects.toThrow('Gateway auth failed');
  });

  it('should resolve on session_complete', async () => {
    const promise = streamAgentEventsViaWebSocket({
      gatewayUrl: 'https://gw.test.com',
      operationId: 'op-1',
      token: 'test-token',
    });

    await flush();
    capturedWs!.simulateMessage({ id: '1', summary: 'All done', type: 'session_complete' });

    await expect(promise).resolves.toBeUndefined();
  });

  it('should ignore heartbeat_ack messages', async () => {
    const promise = streamAgentEventsViaWebSocket({
      gatewayUrl: 'https://gw.test.com',
      operationId: 'op-1',
      token: 'test-token',
    });

    await flush();
    const ws = capturedWs!;

    ws.simulateMessage({ type: 'heartbeat_ack' });
    expect(stdoutSpy).not.toHaveBeenCalled();

    ws.simulateMessage({ id: '1', type: 'session_complete' });
    await promise;
  });

  it('should construct correct WebSocket URL from HTTPS gateway URL', async () => {
    const promise = streamAgentEventsViaWebSocket({
      gatewayUrl: 'https://agent-gateway.lobehub.com',
      operationId: 'op-123',
      token: 'tok',
    });

    await flush();
    expect(capturedWs!.url).toBe('wss://agent-gateway.lobehub.com/ws?operationId=op-123');

    capturedWs!.simulateMessage({ id: '1', type: 'session_complete' });
    await promise;
  });

  it('should render a multi-step agent run with tool calls', async () => {
    const promise = streamAgentEventsViaWebSocket({
      gatewayUrl: 'https://gw.test.com',
      operationId: 'op-1',
      token: 'tok',
      verbose: true,
    });

    await flush();
    const ws = capturedWs!;
    const { log } = await import('./logger');

    // Step 1: thinking + text + tool call
    ws.simulateMessage({
      event: {
        data: null,
        operationId: 'op-1',
        stepIndex: 0,
        timestamp: 1,
        type: 'agent_runtime_init',
      },
      id: '1',
      type: 'agent_event',
    });
    ws.simulateMessage({
      event: { data: null, operationId: 'op-1', stepIndex: 0, timestamp: 2, type: 'step_start' },
      id: '2',
      type: 'agent_event',
    });
    ws.simulateMessage({
      event: {
        data: { chunkType: 'reasoning', reasoning: 'Let me search...' },
        operationId: 'op-1',
        stepIndex: 0,
        timestamp: 3,
        type: 'stream_chunk',
      },
      id: '3',
      type: 'agent_event',
    });
    ws.simulateMessage({
      event: {
        data: { chunkType: 'text', content: 'Searching for news.' },
        operationId: 'op-1',
        stepIndex: 0,
        timestamp: 4,
        type: 'stream_chunk',
      },
      id: '4',
      type: 'agent_event',
    });
    ws.simulateMessage({
      event: {
        data: { toolCalling: { apiName: 'search', id: 'tc-1' } },
        operationId: 'op-1',
        stepIndex: 0,
        timestamp: 5,
        type: 'tool_start',
      },
      id: '5',
      type: 'agent_event',
    });
    ws.simulateMessage({
      event: { data: null, operationId: 'op-1', stepIndex: 0, timestamp: 6, type: 'stream_end' },
      id: '6',
      type: 'agent_event',
    });
    ws.simulateMessage({
      event: {
        data: { stepIndex: 0 },
        operationId: 'op-1',
        stepIndex: 0,
        timestamp: 7,
        type: 'step_complete',
      },
      id: '7',
      type: 'agent_event',
    });

    // Step 2: tool result + final text
    ws.simulateMessage({
      event: { data: null, operationId: 'op-1', stepIndex: 1, timestamp: 8, type: 'step_start' },
      id: '8',
      type: 'agent_event',
    });
    ws.simulateMessage({
      event: {
        data: {
          isSuccess: true,
          payload: { toolCalling: { id: 'tc-1' } },
          result: { content: 'Results...' },
        },
        operationId: 'op-1',
        stepIndex: 1,
        timestamp: 9,
        type: 'tool_end',
      },
      id: '9',
      type: 'agent_event',
    });
    ws.simulateMessage({
      event: {
        data: { chunkType: 'text', content: 'Here are the results.' },
        operationId: 'op-1',
        stepIndex: 1,
        timestamp: 10,
        type: 'stream_chunk',
      },
      id: '10',
      type: 'agent_event',
    });
    ws.simulateMessage({
      event: {
        data: { cost: { total: 0.05 }, stepCount: 2, usage: { total_tokens: 500 } },
        operationId: 'op-1',
        stepIndex: 1,
        timestamp: 11,
        type: 'agent_runtime_end',
      },
      id: '11',
      type: 'agent_event',
    });

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

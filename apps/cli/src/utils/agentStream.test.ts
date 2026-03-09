import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { streamAgentEvents } from './agentStream';

vi.mock('./logger', () => ({
  log: {
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

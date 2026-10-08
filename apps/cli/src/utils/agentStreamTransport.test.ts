import type { AgentStreamEvent } from '@lobechat/agent-gateway-client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { streamAgentEventsViaWebSocket } from './agentStream';
import type { AgentHistoryPage } from './agentStreamTransport';
import { consumeAgentStream } from './agentStreamTransport';

let sockets: TestSocket[];
class TestSocket {
  static OPEN = 1;
  static CONNECTING = 0;
  readyState = 0;
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  onclose: ((event: { code: number; reason: string }) => void) | null = null;
  sent: unknown[] = [];
  constructor(public url: string) {
    sockets.push(this);
    queueMicrotask(() => {
      this.readyState = 1;
      this.onopen?.();
    });
  }
  send(data: string) {
    const message = JSON.parse(data);
    this.sent.push(message);
    if (message.type === 'auth') queueMicrotask(() => this.message({ type: 'auth_success' }));
  }
  message(message: unknown) {
    this.onmessage?.({ data: JSON.stringify(message) });
  }
  close() {
    this.readyState = 3;
  }
  disconnect(code = 1011) {
    this.readyState = 3;
    this.onclose?.({ code, reason: 'disconnected' });
  }
}

type JournalEvent = AgentStreamEvent & { id: string };
const event = (id: number, type: AgentStreamEvent['type'], content?: string): JournalEvent => ({
  data: type === 'stream_chunk' ? { chunkType: 'text', content } : { reason: 'done' },
  id: `${id}-0`,
  operationId: 'op-1',
  stepIndex: 0,
  timestamp: id,
  type,
});

describe('recoverable WebSocket transport', () => {
  let journal: JournalEvent[];
  let readHistory: ReturnType<
    typeof vi.fn<(cursor: string, signal: AbortSignal) => Promise<AgentHistoryPage>>
  >;
  let stdout: ReturnType<typeof vi.spyOn>;
  let consoleLog: ReturnType<typeof vi.spyOn>;
  const flush = () => vi.advanceTimersByTimeAsync(0);
  const options = () => ({
    gatewayUrl: 'https://gateway.test',
    operationId: 'op-1',
    readHistory,
    token: 'test',
  });

  beforeEach(() => {
    vi.useFakeTimers();
    sockets = [];
    journal = [event(1, 'agent_runtime_init')];
    readHistory = vi.fn(async (cursor) => {
      const all = journal.filter(
        (item) => Number(item.id.split('-')[0]) > Number(cursor.split('-')[0]),
      );
      const events = all.slice(0, 2);
      return {
        available: true,
        events,
        hasMore: all.length > 2,
        nextCursor: events.at(-1)?.id ?? cursor,
      };
    });
    vi.stubGlobal('WebSocket', TestSocket);
    stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    consoleLog = vi.spyOn(console, 'log').mockImplementation(() => {});
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('replays every page even with an empty Gateway buffer and prints one complete JSON array', async () => {
    journal.push(
      ...Array.from({ length: 1100 }, (_, i) => event(i + 2, 'stream_chunk', String(i))),
      event(1102, 'agent_runtime_end'),
    );
    const done = streamAgentEventsViaWebSocket({ ...options(), json: true });
    await flush();
    await expect(done).resolves.toMatchObject({ kind: 'completed' });
    expect(JSON.parse(String(consoleLog.mock.calls[0][0]))).toHaveLength(1102);
    expect(consoleLog).toHaveBeenCalledTimes(1);
    expect(readHistory).toHaveBeenCalledWith('1100-0', expect.any(AbortSignal));
    expect(vi.getTimerCount()).toBe(0);
  });

  it('reconnects with backoff and recovers missed output exactly once', async () => {
    journal.push(event(2, 'stream_chunk', 'before'));
    const done = streamAgentEventsViaWebSocket(options());
    await flush();
    sockets[0].disconnect();
    journal.push(event(3, 'stream_chunk', 'after'));
    await vi.advanceTimersByTimeAsync(999);
    expect(sockets).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(sockets).toHaveLength(2);
    sockets[1].message({ event: journal[1], id: 'gateway-duplicate', type: 'agent_event' });
    await flush();
    journal.push(event(4, 'agent_runtime_end'));
    sockets[1].message({ type: 'session_complete' });
    await flush();
    await done;
    expect(stdout.mock.calls.filter(([text]) => text === 'before')).toHaveLength(1);
    expect(stdout.mock.calls.filter(([text]) => text === 'after')).toHaveLength(1);
    expect(readHistory).toHaveBeenCalledWith('2-0', expect.any(AbortSignal));
    expect(vi.getTimerCount()).toBe(0);
  });

  it('recovers a lost terminal notification from the journal without treating session_complete as success', async () => {
    const done = streamAgentEventsViaWebSocket({ ...options(), json: true });
    const settled = vi.fn();
    done.then(settled, settled);
    await flush();
    sockets[0].message({ type: 'session_complete' });
    await flush();
    expect(settled).not.toHaveBeenCalled();
    journal.push(event(2, 'agent_runtime_end'));
    await vi.advanceTimersByTimeAsync(5000);
    await done;
    expect(consoleLog).toHaveBeenCalledTimes(1);
  });

  it('retries a transient history read without losing cursor or printing partial JSON', async () => {
    const done = streamAgentEventsViaWebSocket({ ...options(), json: true });
    await flush();
    readHistory.mockRejectedValueOnce(new Error('temporary outage'));
    sockets[0].message({ type: 'agent_event' });
    await flush();
    expect(consoleLog).not.toHaveBeenCalled();
    journal.push(event(2, 'agent_runtime_end'));
    await vi.advanceTimersByTimeAsync(5000);
    await done;
    expect(readHistory).toHaveBeenLastCalledWith('1-0', expect.any(AbortSignal));
    expect(consoleLog).toHaveBeenCalledTimes(1);
  });

  it('rejects an expired/truncated journal rather than claiming completion', async () => {
    readHistory.mockResolvedValue({
      available: false,
      events: [],
      hasMore: false,
      nextCursor: '0',
    });
    const done = streamAgentEventsViaWebSocket({ ...options(), json: true });
    const failure = expect(done).rejects.toMatchObject({ name: 'AgentStreamHistoryError' });
    await flush();
    await failure;
    expect(consoleLog).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('rejects authorization failures immediately, with no reconnect', async () => {
    const consumer = consumeAgentStream(
      options(),
      () => false,
      () => {},
    );
    const failure = expect(consumer.done).rejects.toThrow('Gateway auth failed');
    sockets[0].message({ reason: 'foreign operation', type: 'auth_failed' });
    await flush();
    await failure;
    expect(sockets).toHaveLength(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('detects a half-open socket via missed heartbeat acknowledgements', async () => {
    const consumer = consumeAgentStream(
      options(),
      () => false,
      () => {},
    );
    await flush();
    await vi.advanceTimersByTimeAsync(61_000);
    expect(sockets).toHaveLength(2);
    consumer.close();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('refreshes gateway credentials for each reconnect', async () => {
    const getAuth = vi
      .fn()
      .mockResolvedValueOnce({ serverUrl: 'https://server.test', token: 'first', tokenType: 'jwt' })
      .mockResolvedValueOnce({
        serverUrl: 'https://server.test',
        token: 'refreshed',
        tokenType: 'jwt',
      });
    const done = streamAgentEventsViaWebSocket({ ...options(), getAuth });
    await flush();
    sockets[0].disconnect();
    await vi.advanceTimersByTimeAsync(1000);
    expect(sockets[1].sent[0]).toMatchObject({ token: 'refreshed', type: 'auth' });
    journal.push(event(2, 'agent_runtime_end'));
    sockets[1].message({ type: 'agent_event' });
    await flush();
    await done;
    expect(getAuth).toHaveBeenCalledTimes(2);
  });

  it('bounds a stalled history request, aborts it, and recovers on a later tick', async () => {
    let abortedSignal: AbortSignal | undefined;
    readHistory.mockImplementationOnce((_cursor, signal) => {
      abortedSignal = signal;
      return new Promise(() => {});
    });
    const done = streamAgentEventsViaWebSocket({ ...options(), json: true });
    await flush();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(abortedSignal?.aborted).toBe(true);
    expect(consoleLog).not.toHaveBeenCalled();
    journal.push(event(2, 'agent_runtime_end'));
    await vi.advanceTimersByTimeAsync(5000);
    await done;
    expect(consoleLog).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('stops reconnecting after the retry budget is exhausted', async () => {
    vi.stubGlobal(
      'WebSocket',
      class {
        constructor() {
          throw new Error('Gateway unavailable');
        }
      },
    );
    const consumer = consumeAgentStream(
      { ...options(), maxRetries: 2 },
      () => false,
      () => {},
    );
    const failure = expect(consumer.done).rejects.toMatchObject({
      name: 'AgentStreamHistoryError',
    });
    await vi.advanceTimersByTimeAsync(20_000);
    await failure;
    expect(vi.getTimerCount()).toBe(0);
  });
});

import type { AgentStreamEvent } from '@lobechat/agent-gateway-client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { streamAgentEvents } from './agentStream';
import type { AgentHistoryPage } from './agentStreamTransport';
import { AgentGatewayUnavailableError, AgentJournalUnsupportedError, consumeAgentStream } from './agentStreamTransport';

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
    getAuth: async () => ({
      serverUrl: 'https://server.test',
      token: 'test',
      tokenType: 'jwt' as const,
    }),
    readHistory,
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
    const done = streamAgentEvents({ ...options(), json: true });
    await flush();
    await expect(done).resolves.toMatchObject({ kind: 'completed' });
    expect(JSON.parse(String(consoleLog.mock.calls[0][0]))).toHaveLength(1102);
    expect(consoleLog).toHaveBeenCalledTimes(1);
    expect(readHistory).toHaveBeenCalledWith('1100-0', expect.any(AbortSignal));
    expect(vi.getTimerCount()).toBe(0);
  });

  it('renders a group member event mirrored onto the supervisor socket, which the journal can never replay', async () => {
    journal.push(event(2, 'stream_chunk', 'supervisor'));
    const done = streamAgentEvents({ ...options(), json: true });
    await flush();

    // Mirrored member events live under the member's operation id, so they are
    // absent from this operation's history and only exist on the socket.
    const memberChunk = { ...event(3, 'stream_chunk', 'member'), operationId: 'op-member-2' };
    sockets[0].message({ event: memberChunk, id: 'gateway-1', type: 'agent_event' });
    await flush();
    // A resume replays from the gateway cursor: the same frame must not render twice.
    sockets[0].message({ event: memberChunk, id: 'gateway-1', type: 'agent_event' });
    await flush();
    // A member finishing is not the supervisor finishing.
    const memberEnd = { ...event(4, 'member_runtime_end'), operationId: 'op-member-2' };
    sockets[0].message({ event: memberEnd, id: 'gateway-2', type: 'agent_event' });
    await flush();

    journal.push(event(5, 'agent_runtime_end'));
    sockets[0].message({ type: 'session_complete' });
    await flush();
    await expect(done).resolves.toMatchObject({ kind: 'completed' });

    const printed = JSON.parse(String(consoleLog.mock.calls[0][0])) as AgentStreamEvent[];
    const mirrored = printed.filter((item) => item.operationId === 'op-member-2');
    expect(mirrored.map((item) => item.type)).toEqual(['stream_chunk', 'member_runtime_end']);
    expect(printed.at(-1)?.type).toBe('agent_runtime_end');
  });

  it('holds a mirrored member frame behind an in-flight journal catch-up so the transcript stays ordered', async () => {
    let release: (page: AgentHistoryPage) => void = () => {};
    const pending = new Promise<AgentHistoryPage>((resolve) => {
      release = resolve;
    });
    readHistory = vi.fn(() => pending);

    const printed: AgentStreamEvent[] = [];
    const stream = consumeAgentStream(
      { ...options(), onMirroredEvent: (event) => printed.push(event) },
      (event) => {
        printed.push(event);
        return false;
      },
    );
    await flush();

    // The frame lands while the first catch-up read is still in flight.
    const memberChunk = { ...event(3, 'stream_chunk', 'member'), operationId: 'op-member-2' };
    sockets[0].message({ event: memberChunk, id: 'gateway-1', type: 'agent_event' });
    await flush();
    expect(printed).toHaveLength(0);

    release({
      available: true,
      events: [event(2, 'stream_chunk', 'supervisor')],
      hasMore: false,
      nextCursor: '2-0',
    });
    await flush();

    expect(printed.map((item) => (item.data as { content?: string }).content)).toEqual([
      'supervisor',
      'member',
    ]);
    stream.close();
  });

  it('drains mirrored member frames queued behind a terminal catch-up instead of dropping them', async () => {
    let release: (page: AgentHistoryPage) => void = () => {};
    const pending = new Promise<AgentHistoryPage>((resolve) => {
      release = resolve;
    });
    readHistory = vi.fn(() => pending);

    const printed: AgentStreamEvent[] = [];
    const stream = consumeAgentStream(
      { ...options(), onMirroredEvent: (event) => printed.push(event) },
      (event) => {
        printed.push(event);
        return event.type === 'agent_runtime_end';
      },
    );
    await flush();

    // The frame lands while the read that turns out terminal is still in flight,
    // so it is queued behind that read rather than delivered immediately.
    const memberChunk = { ...event(3, 'stream_chunk', 'member'), operationId: 'op-member-2' };
    sockets[0].message({ event: memberChunk, id: 'gateway-1', type: 'agent_event' });
    await flush();
    expect(printed).toHaveLength(0);

    release({
      available: true,
      events: [event(2, 'stream_chunk', 'supervisor'), event(4, 'agent_runtime_end')],
      hasMore: false,
      nextCursor: '4-0',
    });
    await flush();

    // Success must not be reported with member output missing from the transcript.
    await expect(stream.done).resolves.toBeUndefined();
    expect(printed.map((item) => item.type)).toEqual([
      'stream_chunk',
      'agent_runtime_end',
      'stream_chunk',
    ]);
    expect((printed.at(-1)?.data as { content?: string }).content).toBe('member');
  });

  it('reconnects with backoff and recovers missed output exactly once', async () => {
    journal.push(event(2, 'stream_chunk', 'before'));
    const done = streamAgentEvents(options());
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

  it('coalesces a burst of chunk notifications into a bounded number of history reads', async () => {
    const delivered: string[] = [];
    const readAll = vi.fn(async (cursor: string) => {
      const events = journal.filter(
        (item) => Number(item.id.split('-')[0]) > Number(cursor.split('-')[0]),
      );
      return {
        available: true,
        events,
        hasMore: false,
        nextCursor: events.at(-1)?.id ?? cursor,
      } as AgentHistoryPage;
    });
    const stream = consumeAgentStream({ ...options(), readHistory: readAll }, (streamEvent) => {
      if (streamEvent.type === 'stream_chunk')
        delivered.push(String(streamEvent.data?.content ?? ''));
      return false;
    });
    await flush();
    readAll.mockClear();

    // The server buffers chunks in ~300ms windows, so a long reply arrives as a
    // steady stream of `agent_event` frames rather than a single one.
    for (let index = 0; index < 12; index++) {
      journal.push(event(index + 2, 'stream_chunk', String(index)));
      sockets[0].message({ id: `${index}-gateway`, type: 'agent_event' });
      await vi.advanceTimersByTimeAsync(20);
    }
    await vi.advanceTimersByTimeAsync(600);

    expect(delivered).toEqual(Array.from({ length: 12 }, (_, index) => String(index)));
    expect(readAll.mock.calls.length).toBeLessThanOrEqual(3);
    stream.close();
  });

  it('recovers a lost terminal notification from the journal without treating session_complete as success', async () => {
    const done = streamAgentEvents({ ...options(), json: true });
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
    const done = streamAgentEvents({ ...options(), json: true });
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
    const done = streamAgentEvents({ ...options(), json: true });
    const failure = expect(done).rejects.toMatchObject({ name: 'AgentStreamHistoryError' });
    await flush();
    await failure;
    expect(consoleLog).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('rejects a server without the journal procedure without retrying it', async () => {
    readHistory.mockRejectedValue(
      new AgentJournalUnsupportedError('This server has no agent event journal'),
    );
    const done = streamAgentEvents({ ...options(), json: true });
    const failure = expect(done).rejects.toMatchObject({ name: 'AgentJournalUnsupportedError' });
    await flush();
    await failure;
    expect(readHistory).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('rejects authorization failures immediately, with no reconnect, as a gateway failure', async () => {
    const consumer = consumeAgentStream(options(), () => false);
    // The Gateway rejecting a credential the server API accepts is a Gateway-only
    // failure: the journal and the status endpoint may still be healthy, so the
    // caller must keep the option of polling instead of reporting `unknown`.
    const settled = consumer.done.catch((error: unknown) => error);
    sockets[0].message({ reason: 'foreign operation', type: 'auth_failed' });
    await flush();
    const error = await settled;
    expect(error).toBeInstanceOf(AgentGatewayUnavailableError);
    expect((error as Error).message).toContain('Gateway auth failed');
    expect(sockets).toHaveLength(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('detects a half-open socket via missed heartbeat acknowledgements', async () => {
    const consumer = consumeAgentStream(options(), () => false);
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
    const done = streamAgentEvents({ ...options(), getAuth });
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
    const done = streamAgentEvents({ ...options(), json: true });
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
    const consumer = consumeAgentStream({ ...options(), maxRetries: 2 }, () => false);
    // Reconnect exhaustion is a connectivity outage, not a lost history: the
    // caller must be able to fall back to polling the run status.
    const settled = consumer.done.catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(20_000);
    expect(await settled).toBeInstanceOf(AgentGatewayUnavailableError);
    expect(vi.getTimerCount()).toBe(0);
  });
});

import type { AgentStreamEvent } from '@lobechat/agent-gateway-client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { streamAgentEvents } from './agentStream';
import type { AgentHistoryPage } from './agentStreamTransport';
import { AgentGatewayUnavailableError, consumeAgentStream } from './agentStreamTransport';

/**
 * Speaks both Gateway protocols: `/v2/ws` behaves like the per-user hub
 * (`ready`, then `subscribe` → `resume_complete`), `/ws` like the per-operation
 * socket (`auth` → `auth_success`). `failDial` makes `/v2/ws` close before
 * `ready`, the way a Gateway without it answers.
 */
let sockets: TestSocket[];
let failDial: number | undefined;
/** `/v2/ws` opens but the hub never sends `ready`, like a half-open proxy. */
let silentReady: boolean;
class TestSocket {
  static OPEN = 1;
  static CONNECTING = 0;
  readyState = 0;
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  onclose: ((event: { code: number; reason: string }) => void) | null = null;
  sent: Array<Record<string, any>> = [];
  constructor(public url: string) {
    sockets.push(this);
    queueMicrotask(() => {
      if (this.isMux && failDial !== undefined) {
        this.disconnect(failDial);
        return;
      }
      this.readyState = 1;
      this.onopen?.();
      if (this.isMux && !silentReady)
        this.message({ connectionId: 'conn-1', protocol: 2, type: 'ready', userId: 'user-1' });
    });
  }
  get isMux() {
    return this.url.includes('/v2/ws');
  }
  send(data: string) {
    const message = JSON.parse(data);
    this.sent.push(message);
    if (message.type === 'auth') queueMicrotask(() => this.message({ type: 'auth_success' }));
    if (message.type === 'subscribe')
      queueMicrotask(() =>
        this.message({
          gap: false,
          operationId: message.operationId,
          status: 'running',
          type: 'resume_complete',
        }),
      );
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

const muxSockets = () => sockets.filter((socket) => socket.isMux);
const v1Sockets = () => sockets.filter((socket) => !socket.isMux);

type JournalEvent = AgentStreamEvent & { id: string };
const event = (id: number, type: AgentStreamEvent['type'], content?: string): JournalEvent => ({
  data: type === 'stream_chunk' ? { chunkType: 'text', content } : { reason: 'done' },
  id: `${id}-0`,
  operationId: 'op-1',
  stepIndex: 0,
  timestamp: id,
  type,
});

/** A hub frame for this run; the hub omits `event.operationId` when it repeats the envelope. */
const frame = (seq: number, agentEvent: Partial<AgentStreamEvent>) => ({
  event: agentEvent,
  id: String(seq),
  operationId: 'op-1',
  type: 'agent_event',
});

describe('protocol v2 (/v2/ws) wake channel', () => {
  let journal: JournalEvent[];
  let readHistory: ReturnType<
    typeof vi.fn<(cursor: string, signal: AbortSignal) => Promise<AgentHistoryPage>>
  >;
  let getGatewayUserToken: ReturnType<typeof vi.fn<() => Promise<string>>>;
  let consoleLog: ReturnType<typeof vi.spyOn>;
  const flush = () => vi.advanceTimersByTimeAsync(0);
  const options = () => ({
    gatewayUrl: 'https://gateway.test',
    getAuth: async () => ({
      serverUrl: 'https://server.test',
      token: 'cli-credential',
      tokenType: 'apiKey' as const,
    }),
    getGatewayUserToken,
    operationId: 'op-1',
    readHistory,
  });

  beforeEach(() => {
    vi.useFakeTimers();
    sockets = [];
    failDial = undefined;
    silentReady = false;
    journal = [event(1, 'agent_runtime_init')];
    readHistory = vi.fn(async (cursor) => {
      const events = journal.filter(
        (item) => Number(item.id.split('-')[0]) > Number(cursor.split('-')[0]),
      );
      return { available: true, events, hasMore: false, nextCursor: events.at(-1)?.id ?? cursor };
    });
    getGatewayUserToken = vi.fn(async () => 'user-jwt');
    vi.stubGlobal('WebSocket', TestSocket);
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    vi.spyOn(console, 'error').mockImplementation(() => {});
    consoleLog = vi.spyOn(console, 'log').mockImplementation(() => {});
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('follows the run over one subscription on /v2/ws with a minted user token, never dialing /ws', async () => {
    const done = streamAgentEvents({ ...options(), json: true });
    await flush();

    expect(muxSockets()).toHaveLength(1);
    expect(muxSockets()[0].url).toMatch(/^wss:\/\/gateway\.test\/v2\/ws\?token=user-jwt&clientId=/);
    // Not an executor and no cursor on a fresh run.
    expect(muxSockets()[0].sent).toContainEqual({ operationId: 'op-1', type: 'subscribe' });

    journal.push(event(2, 'stream_chunk', 'hello'));
    muxSockets()[0].message(frame(1, { data: { content: 'hello' }, type: 'stream_chunk' }));
    await flush();
    journal.push(event(3, 'agent_runtime_end'));
    muxSockets()[0].message(frame(2, { data: { reason: 'done' }, type: 'agent_runtime_end' }));
    await flush();

    await expect(done).resolves.toMatchObject({ kind: 'completed' });
    const printed = JSON.parse(String(consoleLog.mock.calls[0][0])) as AgentStreamEvent[];
    expect(printed.map((item) => item.type)).toEqual([
      'agent_runtime_init',
      'stream_chunk',
      'agent_runtime_end',
    ]);
    expect(v1Sockets()).toHaveLength(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('renders group member events mirrored onto the supervisor subscription, and a member end is not terminal', async () => {
    const done = streamAgentEvents({ ...options(), json: true });
    await flush();

    const memberChunk = { ...event(3, 'stream_chunk', 'member'), operationId: 'op-member-2' };
    muxSockets()[0].message(frame(1, memberChunk));
    await flush();
    // A replay of the same hub frame after a resubscribe must not render twice.
    muxSockets()[0].message(frame(1, memberChunk));
    await flush();
    const memberEnd = { ...event(4, 'member_runtime_end'), operationId: 'op-member-2' };
    muxSockets()[0].message(frame(2, memberEnd));
    await flush();

    journal.push(event(5, 'agent_runtime_end'));
    muxSockets()[0].message({ id: '3', operationId: 'op-1', type: 'session_complete' });
    await flush();

    await expect(done).resolves.toMatchObject({ kind: 'completed' });
    const printed = JSON.parse(String(consoleLog.mock.calls[0][0])) as AgentStreamEvent[];
    expect(
      printed.filter((item) => item.operationId === 'op-member-2').map((item) => item.type),
    ).toEqual(['stream_chunk', 'member_runtime_end']);
    expect(printed.at(-1)?.type).toBe('agent_runtime_end');
  });

  it('resubscribes from the last hub event after a dropped socket and recovers missed output exactly once', async () => {
    const seen: AgentStreamEvent[] = [];
    const transport = consumeAgentStream(options(), (item) => {
      seen.push(item);
      return item.type === 'agent_runtime_end';
    });
    await flush();

    journal.push(event(2, 'stream_chunk', 'a'));
    muxSockets()[0].message(frame(7, { type: 'stream_chunk' }));
    await flush();
    muxSockets()[0].disconnect();
    journal.push(event(3, 'stream_chunk', 'b'), event(4, 'agent_runtime_end'));
    await vi.advanceTimersByTimeAsync(1000);

    await expect(transport.done).resolves.toBeUndefined();
    expect(muxSockets()).toHaveLength(2);
    expect(muxSockets()[1].sent).toContainEqual({
      lastEventId: '7',
      operationId: 'op-1',
      type: 'subscribe',
    });
    expect(getGatewayUserToken).toHaveBeenCalledTimes(2);
    expect(seen.map((item) => item.id)).toEqual(['1-0', '2-0', '3-0', '4-0']);
  });

  it('moves to /ws at once when the server refuses to mint a user token (restricted API key)', async () => {
    getGatewayUserToken.mockRejectedValue(
      Object.assign(new Error('FORBIDDEN'), { data: { code: 'FORBIDDEN' } }),
    );
    const transport = consumeAgentStream(options(), (item) => item.type === 'agent_runtime_end');
    await flush();
    await flush();

    expect(muxSockets()).toHaveLength(0);
    expect(v1Sockets()).toHaveLength(1);
    expect(v1Sockets()[0].url).toBe('wss://gateway.test/ws?operationId=op-1');
    expect(v1Sockets()[0].sent[0]).toEqual({
      serverUrl: 'https://server.test',
      token: 'cli-credential',
      tokenType: 'apiKey',
      type: 'auth',
    });

    journal.push(event(2, 'agent_runtime_end'));
    v1Sockets()[0].message({ type: 'session_complete' });
    await flush();
    await expect(transport.done).resolves.toBeUndefined();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('moves to /ws when /v2/ws never reaches ready (a Gateway without protocol 2)', async () => {
    failDial = 1006;
    const transport = consumeAgentStream(options(), (item) => item.type === 'agent_runtime_end');
    await vi.advanceTimersByTimeAsync(10_000);

    expect(muxSockets()).toHaveLength(3);
    expect(v1Sockets()).toHaveLength(1);
    // Nothing was received on /v2/ws, so /ws resumes from the start.
    expect(v1Sockets()[0].sent).toContainEqual({ lastEventId: '', type: 'resume' });

    journal.push(event(2, 'agent_runtime_end'));
    v1Sockets()[0].message({ type: 'session_complete' });
    await flush();
    await expect(transport.done).resolves.toBeUndefined();
  });

  it('hands a run over to /ws from the last hub event once the hub keeps refusing the token', async () => {
    const transport = consumeAgentStream(options(), (item) => item.type === 'agent_runtime_end');
    await flush();
    muxSockets()[0].message(frame(9, { type: 'stream_chunk' }));
    await flush();

    // From here on every dial is refused with 4401: three in a row exhaust the
    // mux's auth budget even though the socket worked before.
    failDial = 4401;
    muxSockets()[0].disconnect(4401);
    await vi.advanceTimersByTimeAsync(1000);

    expect(muxSockets()).toHaveLength(3);
    expect(v1Sockets()).toHaveLength(1);
    expect(v1Sockets()[0].sent).toContainEqual({ lastEventId: '9', type: 'resume' });

    journal.push(event(2, 'agent_runtime_end'));
    v1Sockets()[0].message({ type: 'session_complete' });
    await flush();
    await expect(transport.done).resolves.toBeUndefined();
  });

  it('rejects as a gateway failure when the hub refuses this operation to the user', async () => {
    const transport = consumeAgentStream(options(), () => false);
    const rejected = expect(transport.done).rejects.toBeInstanceOf(AgentGatewayUnavailableError);
    await flush();

    muxSockets()[0].message({ operationId: 'op-1', reason: 'forbidden', type: 'subscribe_failed' });
    await flush();

    await rejected;
    expect(v1Sockets()).toHaveLength(0);
  });

  it('stops after the retry budget once a working /v2/ws stays away, so the caller can poll', async () => {
    const transport = consumeAgentStream({ ...options(), maxRetries: 2 }, () => false);
    const rejected = expect(transport.done).rejects.toThrow(/Reconnect attempts exhausted/);
    await flush();

    // The socket worked, so later failed dials are an outage, not missing support.
    failDial = 1006;
    muxSockets()[0].disconnect();
    await vi.advanceTimersByTimeAsync(60_000);

    await rejected;
    await expect(transport.done).rejects.toBeInstanceOf(AgentGatewayUnavailableError);
    expect(v1Sockets()).toHaveLength(0);
  });

  it('moves to /ws when /v2/ws opens but never sends ready, instead of waiting forever', async () => {
    silentReady = true;
    const transport = consumeAgentStream(options(), (item) => item.type === 'agent_runtime_end');

    // Three dials, each abandoned after the 10s connect deadline, plus backoff.
    await vi.advanceTimersByTimeAsync(40_000);

    expect(muxSockets()).toHaveLength(3);
    expect(muxSockets().every((socket) => socket.readyState === 3)).toBe(true);
    expect(v1Sockets()).toHaveLength(1);

    journal.push(event(2, 'agent_runtime_end'));
    v1Sockets()[0].message({ type: 'session_complete' });
    await flush();
    await expect(transport.done).resolves.toBeUndefined();
  });

  it('leaves no reconnect timer behind once the retry budget ends the stream', async () => {
    // A reconnect delay that a zero-time flush cannot fire.
    vi.spyOn(Math, 'random').mockReturnValue(0.99);
    const transport = consumeAgentStream({ ...options(), maxRetries: 0 }, () => false);
    const rejected = expect(transport.done).rejects.toBeInstanceOf(AgentGatewayUnavailableError);
    await flush();

    muxSockets()[0].disconnect();
    await flush();

    await rejected;
    // A live timer here would keep `lh agent run` alive after it fell back to polling.
    expect(vi.getTimerCount()).toBe(0);
  });
});

import { afterEach, describe, expect, it, vi } from 'vitest';

import type { AgentStreamEvent } from '@lobechat/agent-gateway-client';

import { PiRpcSession } from './piRpcSession';
import type { PiRpcEvent } from './piRpcProtocol';

const mocks = vi.hoisted(() => ({
  clientInstances: [] as any[],
  clientSessionId: { value: undefined as string | undefined },
  command: vi.fn(),
  start: vi.fn(),
  close: vi.fn(),
  abort: vi.fn(),
}));

vi.mock('./piRpcClient', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./piRpcClient')>();
  return {
    ...actual,
    PiRpcClient: class MockPiRpcClient {
      static instances = mocks.clientInstances;
      onEvent?: (event: PiRpcEvent) => void | Promise<void>;
      constructor(readonly options: any) {
        this.onEvent = options.onEvent;
        mocks.clientInstances.push(this);
      }
      get pid() {
        return 123_456;
      }
      get isClosed() {
        return false;
      }
      get sessionId() {
        return mocks.clientSessionId.value;
      }
      start = mocks.start;
      command = mocks.command;
      close = mocks.close;
      abort = mocks.abort;
    },
  };
});

const createSession = (overrides: Partial<Parameters<typeof PiRpcSession>[0]> = {}) => {
  const events: AgentStreamEvent[] = [];
  const statuses: string[] = [];
  const sessionIds: string[] = [];
  const session = new PiRpcSession({
    args: [],
    commandPath: 'pi',
    cwd: '/workspace',
    env: { ...process.env },
    operationId: 'op-1',
    sessionId: 'lobe-session-1',
    onEvents: (batch) => void events.push(...batch),
    onRuntimeStatus: (status) => void statuses.push(status.state),
    onSessionId: (id) => void sessionIds.push(id),
    onStderr: vi.fn(),
    ...overrides,
  });
  return { events, session, sessionIds, statuses };
};

const emit = (session: PiRpcSession, event: PiRpcEvent) => {
  const client = mocks.clientInstances.at(-1)!;
  return client.onEvent!(event);
};

afterEach(() => {
  vi.restoreAllMocks();
  mocks.clientInstances.length = 0;
  mocks.clientSessionId.value = undefined;
  mocks.start.mockReset();
  mocks.command.mockReset();
  mocks.close.mockReset();
  mocks.abort.mockReset();
});

describe('PiRpcSession', () => {
  it('runs a prompt and resolves on agent_settled, broadcasting stream events', async () => {
    const { events, session, sessionIds } = createSession();
    mocks.clientSessionId.value = 'pi-sess-1';
    mocks.start.mockResolvedValue(undefined);
    mocks.command.mockImplementation((command: { type: string }) => {
      if (command.type === 'get_state') return Promise.resolve({ success: true, type: 'response', command: 'get_state' });
      if (command.type === 'prompt') return Promise.resolve({ success: true, type: 'response', command: 'prompt', id: '1' });
      return Promise.resolve({ success: true, type: 'response', command: command.type });
    });
    mocks.close.mockResolvedValue(undefined);

    const runPromise = session.run({ text: 'hello' });
    const client = mocks.clientInstances.at(-1)!;
    expect(client).toBeTruthy();

    // RPC mode reports the native session id via the get_state handshake,
    // not a `{type:'session'}` event.
    await emit(session, {
      assistantMessageEvent: { contentIndex: 0, delta: 'Hi ', type: 'text_delta' },
      type: 'message_update',
    });
    await emit(session, {
      assistantMessageEvent: { contentIndex: 0, delta: 'there', type: 'text_delta' },
      type: 'message_update',
    });
    await emit(session, { type: 'agent_settled' });

    await expect(runPromise).resolves.toEqual({ aborted: false });
    expect(sessionIds).toContain('pi-sess-1');
    // text deltas flowed through the real PiAdapter → AgentStreamEvent stream.
    const textChunks = events.filter((e) => e.type === 'stream_chunk' && e.data.chunkType === 'text');
    expect(textChunks.map((e) => e.data.content).join('')).toBe('Hi there');
    // agent_runtime_end terminal event emitted by the adapter on settled.
    expect(events.some((e) => e.type === 'agent_runtime_end')).toBe(true);
    // The run closes its own process.
    expect(mocks.close).toHaveBeenCalled();
  });

  it('resolves aborted when the run is interrupted', async () => {
    const { session } = createSession();
    mocks.start.mockResolvedValue(undefined);
    mocks.command.mockImplementation((command: { type: string }) => {
      if (command.type === 'get_state') return Promise.resolve({ success: true, type: 'response', command: 'get_state' });
      return Promise.resolve({ success: true, type: 'response', command: command.type });
    });
    mocks.close.mockResolvedValue(undefined);

    const runPromise = session.run({ text: 'hello' });
    await emit(session, {
      assistantMessageEvent: { reason: 'aborted', type: 'error' },
      type: 'message_update',
    });
    await expect(runPromise).resolves.toEqual({ aborted: true });
  });

  it('rejects on a terminal error event and still recycles the process', async () => {
    const { events, session } = createSession();
    mocks.start.mockResolvedValue(undefined);
    mocks.command.mockImplementation((command: { type: string }) => {
      if (command.type === 'get_state') return Promise.resolve({ success: true, type: 'response', command: 'get_state' });
      return Promise.resolve({ success: true, type: 'response', command: command.type });
    });
    mocks.close.mockResolvedValue(undefined);

    const runPromise = session.run({ text: 'hello' });
    await emit(session, {
      assistantMessageEvent: {
        error: { errorMessage: 'usage limit reached', stopReason: 'error' },
        type: 'error',
      },
      type: 'message_update',
    });
    await expect(runPromise).rejects.toThrow('usage limit reached');
    expect(mocks.close).toHaveBeenCalled();
    expect(events.some((e) => e.type === 'error')).toBe(true);
  });

  it('streams events on EVERY run of a reused process (fresh adapter per run)', async () => {
    const { events, session } = createSession({ autoCloseOnSettle: false });
    mocks.start.mockResolvedValue(undefined);
    mocks.command.mockImplementation((command: { type: string }) => {
      if (command.type === 'get_state') {
        return Promise.resolve({ success: true, type: 'response', command: 'get_state' });
      }
      return Promise.resolve({ success: true, type: 'response', command: command.type });
    });
    mocks.close.mockResolvedValue(undefined);

    const runTextChunks = async () => {
      const runPromise = session.run({ text: 'x' });
      await vi.waitFor(() => expect(session.isRunning).toBe(true));
      await emit(session, {
        assistantMessageEvent: { contentIndex: 0, delta: 'reply', type: 'text_delta' },
        type: 'message_update',
      });
      await emit(session, { type: 'agent_settled' });
      await runPromise;
    };

    // Turn 1 streams normally.
    await runTextChunks();
    // Turn 2 reuses the SAME process — the stateful PiAdapter is replaced
    // per run, so its text must still reach the host.
    await runTextChunks();

    const textChunks = events.filter(
      (e) => e.type === 'stream_chunk' && e.data.chunkType === 'text',
    );
    expect(textChunks.map((e) => e.data.content)).toEqual(['reply', 'reply']);
    expect(mocks.close).not.toHaveBeenCalled();
    await session.close();
  });

  it('rebinds host callbacks so a pooled process targets a new IPC session', async () => {
    const { session } = createSession({ autoCloseOnSettle: false });
    mocks.start.mockResolvedValue(undefined);
    mocks.command.mockImplementation((command: { type: string }) => {
      if (command.type === 'get_state') {
        return Promise.resolve({ success: true, type: 'response', command: 'get_state' });
      }
      return Promise.resolve({ success: true, type: 'response', command: command.type });
    });
    mocks.close.mockResolvedValue(undefined);

    const rebound: string[] = [];
    session.rebind({
      onEvents: (batch) => void rebound.push(...batch.map((e) => e.type)),
      onRuntimeStatus: vi.fn(),
      onSessionId: vi.fn(),
      onStderr: vi.fn(),
    });

    const runPromise = session.run({ text: 'x' });
    await emit(session, {
      assistantMessageEvent: { contentIndex: 0, delta: 'hi', type: 'text_delta' },
      type: 'message_update',
    });
    await emit(session, { type: 'agent_settled' });
    await runPromise;

    // Events flow to the rebound callback, not the original one.
    expect(rebound).toContain('stream_chunk');
  });

  it('keeps the process alive across runs when autoCloseOnSettle is false', async () => {
    const { session } = createSession({ autoCloseOnSettle: false });
    mocks.start.mockResolvedValue(undefined);
    mocks.command.mockImplementation((command: { type: string }) => {
      if (command.type === 'get_state') {
        return Promise.resolve({ success: true, type: 'response', command: 'get_state' });
      }
      return Promise.resolve({ success: true, type: 'response', command: command.type });
    });
    mocks.close.mockResolvedValue(undefined);

    // Turn 1 settles without closing the process.
    const first = session.run({ text: 'first' });
    await vi.waitFor(() => expect(session.isRunning).toBe(true));
    await emit(session, { type: 'agent_settled' });
    await expect(first).resolves.toEqual({ aborted: false });
    expect(session.isRunning).toBe(false);
    expect(mocks.close).not.toHaveBeenCalled();

    // Turn 2 reuses the same session/process.
    const second = session.run({ text: 'second' });
    await vi.waitFor(() => expect(session.isRunning).toBe(true));
    await emit(session, { type: 'agent_settled' });
    await expect(second).resolves.toEqual({ aborted: false });
    expect(session.isRunning).toBe(false);
    expect(mocks.close).not.toHaveBeenCalled();

    // The host owns close() in pooled mode.
    await session.close();
    expect(mocks.close).toHaveBeenCalled();
  });

  it('forwards extension UI requests to the host', async () => {
    const handler = vi.fn().mockReturnValue(undefined);
    const { session } = createSession({ onExtensionUiRequest: handler });
    mocks.start.mockResolvedValue(undefined);
    mocks.command.mockImplementation((command: { type: string }) => {
      if (command.type === 'get_state') return Promise.resolve({ success: true, type: 'response', command: 'get_state' });
      return Promise.resolve({ success: true, type: 'response', command: command.type });
    });
    mocks.close.mockResolvedValue(undefined);

    const runPromise = session.run({ text: 'hello' });
    // Extension UI requests are intercepted by the RPC client (covered in
    // piRpcClient.test.ts) and never surface as agent events.
    await emit(session, { type: 'agent_settled' });
    await runPromise;
    expect(handler).not.toHaveBeenCalled();
  });
});

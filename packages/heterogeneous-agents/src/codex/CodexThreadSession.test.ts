import { describe, expect, it, vi } from 'vitest';

import {
  CodexAppServerConnectionError,
  CodexAppServerRpcError,
  isCodexAppServerCompatibilityError,
} from './CodexAppServerClient';
import { CodexThreadSession } from './CodexThreadSession';

const turn = (id: string, status: 'completed' | 'inProgress' | 'interrupted') => ({
  completedAt: status === 'inProgress' ? null : 2,
  durationMs: status === 'inProgress' ? null : 1000,
  error: null,
  id,
  items: [],
  itemsView: 'full',
  startedAt: 1,
  status,
});

interface ClientHarness {
  client: any;
  disconnect: () => void;
  notify: (method: string, params: unknown) => Promise<void> | void;
  registeredResumeParams: () => unknown;
  releaseConsumer: ReturnType<typeof vi.fn>;
  requests: Array<{ method: string; params: unknown }>;
  resolveThreadStart: () => void;
  resolveTurnStart: () => void;
  resume: (model?: string) => Promise<void> | void;
}

const createClientHarness = (
  options: {
    autoComplete?: boolean;
    delayThreadStart?: boolean;
    delayTurnStart?: boolean;
    disconnectOnInterrupt?: boolean;
    connectError?: Error;
    failResume?: boolean;
    initialThreadId?: string;
    interruptError?: Error;
    malformedThreadStart?: boolean;
    /** Statuses returned by successive `thread/resume` calls; later calls report idle. */
    resumeStatuses?: Array<'active' | 'idle' | 'systemError'>;
    threadNameError?: Error;
  } = {},
): ClientHarness => {
  let disconnectHandler: (() => void) | undefined;
  let notificationHandler: ((method: string, params: unknown) => Promise<void>) | undefined;
  let registration:
    | {
        onResume: (response: unknown) => Promise<void> | void;
        onResumeError: (error: Error) => Promise<void> | void;
      }
    | undefined;
  let resumeParams: unknown;
  let turnSequence = 0;
  const releaseConsumer = vi.fn();
  const requests: Array<{ method: string; params: unknown }> = [];
  const notify = (method: string, params: unknown) => notificationHandler?.(method, params);
  let resolveThreadStart = () => {};
  const threadStartGate = options.delayThreadStart
    ? new Promise<void>((resolve) => {
        resolveThreadStart = resolve;
      })
    : Promise.resolve();
  let resolveTurnStart = () => {};
  const turnStartGate = options.delayTurnStart
    ? new Promise<void>((resolve) => {
        resolveTurnStart = resolve;
      })
    : Promise.resolve();

  const client = {
    acquireConsumer: vi.fn(() => releaseConsumer),
    acquireThread: vi.fn(() => vi.fn()),
    connect: options.connectError
      ? vi.fn().mockRejectedValue(options.connectError)
      : vi.fn().mockResolvedValue({ userAgent: 'codex-test' }),
    onDisconnect: vi.fn((handler: () => void) => {
      disconnectHandler = handler;
      return vi.fn();
    }),
    onRawMessage: vi.fn(() => vi.fn()),
    onStderr: vi.fn(() => vi.fn()),
    registerThread: vi.fn((_threadId: string, params: unknown, value: typeof registration) => {
      resumeParams = params;
      registration = value;
      return vi.fn(() => {
        if (registration === value) registration = undefined;
      });
    }),
    request: vi.fn(async (method: string, params: unknown) => {
      requests.push({ method, params });
      if (method === 'thread/start') {
        await threadStartGate;
        if (options.malformedThreadStart) return { thread: {} };
        return { model: 'gpt-5.5-codex', thread: { id: 'thread-1' } };
      }
      if (method === 'thread/resume') {
        if (options.failResume) throw new Error('Thread not found');
        return {
          model: 'gpt-5.5-codex',
          thread: {
            id: options.initialThreadId ?? 'thread-1',
            status: { type: options.resumeStatuses?.shift() ?? 'idle' },
          },
        };
      }
      if (method === 'thread/name/set') {
        if (options.threadNameError) throw options.threadNameError;
        return {};
      }
      if (method === 'turn/start') {
        await turnStartGate;
        const turnId = `turn-${++turnSequence}`;
        if (options.autoComplete !== false) {
          setTimeout(() => {
            void notify('turn/started', {
              threadId: options.initialThreadId ?? 'thread-1',
              turn: turn(turnId, 'inProgress'),
            });
            void notify('item/agentMessage/delta', {
              delta: `answer-${turnSequence}`,
              itemId: `message-${turnSequence}`,
              threadId: options.initialThreadId ?? 'thread-1',
              turnId,
            });
            void notify('turn/completed', {
              threadId: options.initialThreadId ?? 'thread-1',
              turn: turn(turnId, 'completed'),
            });
          }, 0);
        }
        return { turn: turn(turnId, 'inProgress') };
      }
      if (method === 'turn/interrupt') {
        if (options.disconnectOnInterrupt) disconnectHandler?.();
        if (options.interruptError) throw options.interruptError;
        const { threadId, turnId } = params as { threadId: string; turnId: string };
        setTimeout(() => {
          void notify('turn/completed', {
            threadId,
            turn: turn(turnId, 'interrupted'),
          });
        }, 0);
        return {};
      }
    }),
    subscribe: vi.fn((_threadId: string, handler: typeof notificationHandler) => {
      notificationHandler = handler;
      return vi.fn();
    }),
    subscribeServerRequests: vi.fn(() => vi.fn()),
  };

  return {
    client,
    disconnect: () => disconnectHandler?.(),
    notify,
    registeredResumeParams: () => resumeParams,
    releaseConsumer,
    requests,
    resolveThreadStart,
    resolveTurnStart,
    resume: (model = 'gpt-5.5-codex') =>
      registration?.onResume({ model, thread: { id: options.initialThreadId ?? 'thread-1' } }),
  };
};

const createSession = (
  harness: ClientHarness,
  options: { initialThreadId?: string; onEventsError?: Error; threadName?: string } = {},
) => {
  const events: any[] = [];
  const statuses: string[] = [];
  const onSessionId = vi.fn();
  const session = new CodexThreadSession({
    client: harness.client,
    initialThreadId: options.initialThreadId,
    threadName: options.threadName,
    onEvents: (batch) => {
      if (options.onEventsError) throw options.onEventsError;
      events.push(...batch);
    },
    onRuntimeStatus: ({ state }) => statuses.push(state),
    onSessionId,
    sessionId: 'session-1',
    threadParams: {
      approvalPolicy: 'never',
      cwd: '/workspace',
      sandbox: 'danger-full-access',
    },
  });
  const run = (operationId: string, text: string) =>
    session.run({
      input: [{ text, text_elements: [], type: 'text' }],
      onRawMessage: vi.fn(),
      operationId,
    });
  return { events, onSessionId, run, session, statuses };
};

describe('CodexThreadSession', () => {
  const provenance = (operationId: string) => ({
    LOBEHUB_AGENT_ID: 'agent',
    LOBEHUB_OPERATION_ID: operationId,
    LOBEHUB_TOPIC_ID: 'topic',
  });
  const runWithProvenance = (session: CodexThreadSession, operationId: string) =>
    session.run({
      input: [{ text: 'hello', text_elements: [], type: 'text' }],
      onRawMessage: () => {},
      operationId,
      provenance: provenance(operationId),
    });

  it('unsubscribes and resumes the loaded thread with the current run provenance', async () => {
    const harness = createClientHarness();
    const { session } = createSession(harness);

    try {
      await runWithProvenance(session, 'op-a');
      await runWithProvenance(session, 'op-b');

      const threadRequests = harness.requests.filter(({ method }) =>
        ['thread/start', 'thread/unsubscribe', 'thread/resume'].includes(method),
      );
      expect(threadRequests.map(({ method }) => method)).toEqual([
        'thread/start',
        'thread/unsubscribe',
        'thread/resume',
      ]);
      expect(threadRequests.at(-1)?.params).toMatchObject({
        config: {
          shell_environment_policy: {
            set: { LOBEHUB_OPERATION_ID: 'op-b', LOBEHUB_TOPIC_ID: 'topic' },
          },
        },
      });
    } finally {
      session.close();
    }
  });

  it('replaces queued reconnect params when the next run has new provenance', async () => {
    const harness = createClientHarness();
    const { session } = createSession(harness);

    try {
      await runWithProvenance(session, 'old');
      harness.disconnect();
      harness.client.connect.mockImplementationOnce(async () => {
        await harness.resume();
      });
      await runWithProvenance(session, 'new');

      const resume = harness.requests.filter(({ method }) => method === 'thread/resume');
      expect(resume.at(-1)?.params).toMatchObject({
        config: { shell_environment_policy: { set: { LOBEHUB_OPERATION_ID: 'new' } } },
      });
      expect(harness.registeredResumeParams()).toMatchObject({
        config: { shell_environment_policy: { set: { LOBEHUB_OPERATION_ID: 'new' } } },
      });
    } finally {
      session.close();
    }
  });

  it('does not resume after closing during an unsubscribe request', async () => {
    const harness = createClientHarness({ initialThreadId: 'existing' });
    const { session } = createSession(harness, { initialThreadId: 'existing' });
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const request = harness.client.request.getMockImplementation();
    harness.client.request.mockImplementation(async (method: string, params: unknown) => {
      if (method === 'thread/unsubscribe') await gate;
      return request(method, params);
    });

    const run = runWithProvenance(session, 'old');
    await vi.waitFor(() =>
      expect(harness.client.request).toHaveBeenCalledWith('thread/unsubscribe', {
        threadId: 'existing',
      }),
    );
    session.close();
    release();
    await run;

    expect(harness.requests.map(({ method }) => method)).toEqual(['thread/unsubscribe']);
  });

  it('reports a claimed native thread as a run error instead of failing construction', async () => {
    const harness = createClientHarness({ initialThreadId: 'thread-existing' });
    harness.client.acquireThread.mockImplementation(() => {
      throw new Error('Codex thread already has an active session: thread-existing');
    });
    const { session, statuses } = createSession(harness, { initialThreadId: 'thread-existing' });

    await expect(runWithProvenance(session, 'op-a')).rejects.toThrow(
      'already has an active session',
    );
    expect(statuses.at(-1)).toBe('error');
    expect(harness.requests).toEqual([]);
    session.close();
  });

  it('waits for a turn interrupted by a closed session to settle before resuming', async () => {
    const harness = createClientHarness({
      initialThreadId: 'thread-existing',
      resumeStatuses: ['active', 'active'],
    });
    const { session } = createSession(harness, { initialThreadId: 'thread-existing' });

    try {
      await runWithProvenance(session, 'op-next');
      expect(harness.requests.map(({ method }) => method)).toEqual([
        'thread/unsubscribe',
        'thread/resume',
        'thread/unsubscribe',
        'thread/resume',
        'thread/unsubscribe',
        'thread/resume',
        'turn/start',
      ]);
    } finally {
      session.close();
    }
  });

  it('gives up when the previous turn never settles', async () => {
    vi.useFakeTimers();
    const harness = createClientHarness({
      initialThreadId: 'thread-existing',
      resumeStatuses: Array.from({ length: 100 }, () => 'active' as const),
    });
    const { session } = createSession(harness, { initialThreadId: 'thread-existing' });

    try {
      const run = runWithProvenance(session, 'op-next');
      const assertion = expect(run).rejects.toThrow('still finishing the previous turn');
      await vi.advanceTimersByTimeAsync(11_000);
      await assertion;
      expect(session.canFallbackToExec).toBe(false);
      expect(harness.requests.some(({ method }) => method === 'turn/start')).toBe(false);
    } finally {
      session.close();
      vi.useRealTimers();
    }
  });

  it('runs on a resumed thread that reports a non-active status', async () => {
    const harness = createClientHarness({
      initialThreadId: 'thread-existing',
      resumeStatuses: ['systemError'],
    });
    const { session } = createSession(harness, { initialThreadId: 'thread-existing' });

    try {
      await runWithProvenance(session, 'op-a');
      expect(harness.requests.map(({ method }) => method)).toEqual([
        'thread/unsubscribe',
        'thread/resume',
        'turn/start',
      ]);
    } finally {
      session.close();
    }
  });

  it('sets the original prompt as the name of a new persisted thread', async () => {
    const harness = createClientHarness();
    const { run, session } = createSession(harness, { threadName: 'Original prompt title' });

    await run('operation-1', 'workspace-enriched input');
    session.close();

    expect(harness.requests.slice(0, 3)).toEqual([
      {
        method: 'thread/start',
        params: {
          approvalPolicy: 'never',
          cwd: '/workspace',
          sandbox: 'danger-full-access',
        },
      },
      {
        method: 'thread/name/set',
        params: { name: 'Original prompt title', threadId: 'thread-1' },
      },
      {
        method: 'turn/start',
        params: {
          input: [{ text: 'workspace-enriched input', text_elements: [], type: 'text' }],
          threadId: 'thread-1',
        },
      },
    ]);
  });

  it('does not block the first turn when thread naming is unsupported', async () => {
    const harness = createClientHarness({ threadNameError: new Error('Method not found') });
    const { run, session } = createSession(harness, { threadName: 'Original prompt title' });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    try {
      await expect(run('operation-1', 'workspace-enriched input')).resolves.toBeUndefined();
      expect(harness.requests.map(({ method }) => method)).toEqual([
        'thread/start',
        'thread/name/set',
        'turn/start',
      ]);
    } finally {
      warn.mockRestore();
      session.close();
    }
  });

  it('reuses one native thread across multiple turns', async () => {
    const harness = createClientHarness();
    const { events, onSessionId, run, session, statuses } = createSession(harness);

    await run('operation-1', 'first');
    await run('operation-2', 'second');
    session.close();

    expect(harness.requests.map(({ method }) => method)).toEqual([
      'thread/start',
      'turn/start',
      'turn/start',
    ]);
    expect(harness.client.onRawMessage).toHaveBeenCalledWith('thread-1', expect.any(Function));
    expect(onSessionId).toHaveBeenCalledOnce();
    expect(statuses).toEqual([
      'starting',
      'running',
      'idle',
      'starting',
      'running',
      'idle',
      'closed',
    ]);
    expect(
      events
        .filter(({ data, type }) => type === 'stream_chunk' && data.chunkType === 'text')
        .map(({ operationId, data }) => ({ content: data.content, operationId })),
    ).toEqual([
      { content: 'answer-1', operationId: 'operation-1' },
      { content: 'answer-2', operationId: 'operation-2' },
    ]);
  });

  it('resumes an existing thread before starting its first native turn', async () => {
    const harness = createClientHarness({ initialThreadId: 'thread-existing' });
    const { onSessionId, run, session } = createSession(harness, {
      initialThreadId: 'thread-existing',
      threadName: 'Do not rename existing thread',
    });

    await run('operation-1', 'continue');
    session.close();

    expect(harness.requests.slice(0, 2)).toEqual([
      {
        method: 'thread/resume',
        params: {
          approvalPolicy: 'never',
          cwd: '/workspace',
          sandbox: 'danger-full-access',
          threadId: 'thread-existing',
        },
      },
      {
        method: 'turn/start',
        params: {
          input: [{ text: 'continue', text_elements: [], type: 'text' }],
          threadId: 'thread-existing',
        },
      },
    ]);
    expect(onSessionId).not.toHaveBeenCalled();
    expect(harness.registeredResumeParams()).toEqual({
      approvalPolicy: 'never',
      cwd: '/workspace',
      sandbox: 'danger-full-access',
      threadId: 'thread-existing',
    });
  });

  it('never allows exec fallback for an existing thread, including initialize failures', async () => {
    const initializeError = new CodexAppServerConnectionError('Initialize failed', {
      phase: 'initialize',
    });
    const harness = createClientHarness({
      connectError: initializeError,
      initialThreadId: 'thread-existing',
    });
    const { run, session } = createSession(harness, { initialThreadId: 'thread-existing' });

    await expect(run('operation-1', 'continue')).rejects.toBe(initializeError);

    expect(session.canFallbackToExec).toBe(false);
    session.close();
  });

  it('does not allow exec fallback after initialize succeeds for an existing thread', async () => {
    const harness = createClientHarness({
      failResume: true,
      initialThreadId: 'thread-existing',
    });
    const { run, session } = createSession(harness, { initialThreadId: 'thread-existing' });

    await expect(run('operation-1', 'continue')).rejects.toThrow('Thread not found');

    expect(session.canFallbackToExec).toBe(false);
    session.close();
  });

  it('classifies a malformed initial thread/start response for safe exec fallback', async () => {
    const harness = createClientHarness({ malformedThreadStart: true });
    const { run, session } = createSession(harness);

    const error = await run('operation-1', 'start').catch((cause) => cause);

    expect(error).toBeInstanceOf(CodexAppServerConnectionError);
    expect(isCodexAppServerCompatibilityError(error)).toBe(true);
    expect(session.canFallbackToExec).toBe(true);
    session.close();
  });

  it('does not register a thread if the host closes while thread/start is pending', async () => {
    const harness = createClientHarness({ delayThreadStart: true });
    const { run, session, statuses } = createSession(harness);
    const running = run('operation-1', 'wait');
    await vi.waitFor(() =>
      expect(harness.requests.some(({ method }) => method === 'thread/start')).toBe(true),
    );

    session.close();
    harness.resolveThreadStart();
    await running;

    expect(harness.client.registerThread).not.toHaveBeenCalled();
    expect(harness.releaseConsumer).toHaveBeenCalledOnce();
    expect(statuses).toEqual(['starting', 'closed']);
  });

  it('interrupts the active turn through turn/interrupt', async () => {
    const harness = createClientHarness({ autoComplete: false });
    const { events, run, session } = createSession(harness);

    const running = run('operation-1', 'wait');
    await vi.waitFor(() =>
      expect(harness.requests.some(({ method }) => method === 'turn/start')).toBe(true),
    );
    await session.interrupt();
    await running;
    session.close();

    expect(harness.requests).toContainEqual({
      method: 'turn/interrupt',
      params: { threadId: 'thread-1', turnId: 'turn-1' },
    });
    expect(events).toContainEqual(
      expect.objectContaining({
        data: { reason: 'interrupted' },
        type: 'agent_runtime_end',
      }),
    );
  });

  it('keeps the thread reusable when interrupt loses a race with transport disconnect', async () => {
    const harness = createClientHarness({
      autoComplete: false,
      disconnectOnInterrupt: true,
      interruptError: new CodexAppServerConnectionError('Transport disconnected'),
    });
    const { run, session } = createSession(harness);
    const interrupted = run('operation-1', 'wait');
    await vi.waitFor(() =>
      expect(harness.requests.some(({ method }) => method === 'turn/start')).toBe(true),
    );

    await expect(session.interrupt()).resolves.toBeUndefined();
    await interrupted;

    const nextTurn = run('operation-2', 'continue');
    await vi.waitFor(() =>
      expect(harness.requests.filter(({ method }) => method === 'turn/start')).toHaveLength(2),
    );
    harness.disconnect();
    await nextTurn;
    session.close();
  });

  it('does not suppress a genuine interrupt RPC error when transport also disconnects', async () => {
    const rpcError = new CodexAppServerRpcError(
      'Turn cannot be interrupted',
      -32_602,
      undefined,
      'turn/interrupt',
    );
    const harness = createClientHarness({
      autoComplete: false,
      disconnectOnInterrupt: true,
      interruptError: rpcError,
    });
    const { run, session } = createSession(harness);
    const interrupted = run('operation-1', 'wait');
    await vi.waitFor(() =>
      expect(harness.requests.some(({ method }) => method === 'turn/start')).toBe(true),
    );

    await expect(session.interrupt()).rejects.toBe(rpcError);
    await interrupted;
    session.close();
  });

  it('remembers an interrupt requested before turn/start returns its turn id', async () => {
    const harness = createClientHarness({ autoComplete: false, delayTurnStart: true });
    const { run, session } = createSession(harness);

    const running = run('operation-1', 'wait');
    await vi.waitFor(() =>
      expect(harness.requests.some(({ method }) => method === 'turn/start')).toBe(true),
    );
    await session.interrupt();
    harness.resolveTurnStart();
    await running;
    session.close();

    expect(harness.requests).toContainEqual({
      method: 'turn/interrupt',
      params: { threadId: 'thread-1', turnId: 'turn-1' },
    });
  });

  it('does not turn a received completion into an interruption if the transport exits next', async () => {
    const harness = createClientHarness({ autoComplete: false });
    const { events, run, session } = createSession(harness);
    const running = run('operation-1', 'finish');
    await vi.waitFor(() =>
      expect(harness.requests.some(({ method }) => method === 'turn/start')).toBe(true),
    );

    const notification = harness.notify('turn/completed', {
      threadId: 'thread-1',
      turn: turn('turn-1', 'completed'),
    });
    harness.disconnect();
    await notification;
    await running;
    session.close();

    const terminalEvents = events.filter(({ type }) => type === 'agent_runtime_end');
    expect(terminalEvents).toHaveLength(1);
    expect(terminalEvents[0].data).toEqual({});
  });

  it('settles a crashed turn immediately as interrupted, then resumes on the next turn', async () => {
    const harness = createClientHarness({ autoComplete: false });
    const { events, run, session } = createSession(harness);
    let settled = false;

    const crashedTurn = run('operation-1', 'crash').finally(() => {
      settled = true;
    });
    await vi.waitFor(() =>
      expect(harness.requests.some(({ method }) => method === 'turn/start')).toBe(true),
    );
    harness.disconnect();
    await crashedTurn;
    expect(settled).toBe(true);
    expect(events).toContainEqual(
      expect.objectContaining({
        data: { reason: 'interrupted' },
        operationId: 'operation-1',
        type: 'agent_runtime_end',
      }),
    );

    const nextTurn = run('operation-2', 'continue');
    await vi.waitFor(() =>
      expect(harness.requests.filter(({ method }) => method === 'turn/start')).toHaveLength(2),
    );
    harness.disconnect();
    await nextTurn;
    session.close();
  });

  it('surfaces notification emission failures instead of completing a partial turn', async () => {
    const emissionError = new Error('Renderer event delivery failed');
    const harness = createClientHarness();
    const { run, session, statuses } = createSession(harness, { onEventsError: emissionError });

    await expect(run('operation-1', 'fail delivery')).rejects.toBe(emissionError);

    expect(statuses).toEqual(['starting', 'running', 'error']);
    session.close();
  });
});

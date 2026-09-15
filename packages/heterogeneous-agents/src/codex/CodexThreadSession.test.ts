import { describe, expect, it, vi } from 'vitest';

import { AskUserBridge } from '../askUser/AskUserBridge';
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
  requestFromServer: (method: string, params: unknown) => Promise<unknown>;
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
    threadNameError?: Error;
  } = {},
): ClientHarness => {
  let disconnectHandler: (() => void) | undefined;
  let notificationHandler: ((method: string, params: unknown) => Promise<void>) | undefined;
  let serverRequestHandler:
    | ((
        method: string,
        params: unknown,
        context: { onResponseSent: (callback: () => Promise<void> | void) => void },
      ) => Promise<unknown> | unknown)
    | undefined;
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
      return vi.fn();
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
          thread: { id: options.initialThreadId ?? 'thread-1' },
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
    subscribeServerRequests: vi.fn(
      (
        _threadId: string,
        handler: (
          method: string,
          params: unknown,
          context: { onResponseSent: (callback: () => Promise<void> | void) => void },
        ) => Promise<unknown> | unknown,
      ) => {
        serverRequestHandler = handler;
        return vi.fn();
      },
    ),
  };

  return {
    client,
    disconnect: () => disconnectHandler?.(),
    notify,
    requestFromServer: async (method, params) => {
      if (!serverRequestHandler) throw new Error('server request handler is not attached');
      let onResponseSent: (() => Promise<void> | void) | undefined;
      const response = await serverRequestHandler(method, params, {
        onResponseSent: (callback) => {
          onResponseSent = callback;
        },
      });
      await onResponseSent?.();
      return response;
    },
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
  const run = (operationId: string, text: string, askUserBridge?: AskUserBridge) =>
    session.run({
      askUserBridge,
      input: [{ text, text_elements: [], type: 'text' }],
      onRawMessage: vi.fn(),
      operationId,
    });
  return { events, onSessionId, run, session, statuses };
};

describe('CodexThreadSession', () => {
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

  it('bridges a command approval with exact Codex decision ids', async () => {
    const harness = createClientHarness({ autoComplete: false });
    const { events, run, session } = createSession(harness);
    const bridge = new AskUserBridge('operation-1', {
      identifier: 'claude-code',
      provider: 'codex',
    });
    const bridgeEvents = bridge.events()[Symbol.asyncIterator]();
    const runPromise = run('operation-1', 'run a command', bridge);
    await vi.waitFor(() =>
      expect(harness.requests.some(({ method }) => method === 'turn/start')).toBe(true),
    );

    const responsePromise = harness.requestFromServer('item/commandExecution/requestApproval', {
      approvalId: 'approval-1',
      availableDecisions: ['decline', 'accept'],
      command: 'do-not-persist-this-command',
      itemId: 'command-1',
      startedAtMs: 1,
      threadId: 'thread-1',
      turnId: 'turn-1',
    });
    const intervention = await bridgeEvents.next();
    expect(intervention.value).toMatchObject({
      data: {
        identifier: 'claude-code',
        interactionKind: 'permission',
        provider: 'codex',
        toolCallId: 'codex-command-approval-approval-1',
      },
      operationId: 'operation-1',
      type: 'agent_intervention_request',
    });
    const arguments_ = JSON.parse(intervention.value!.data.arguments);
    expect(arguments_.questions[0].options.map(({ id }: { id: string }) => id)).toEqual([
      'decline',
      'accept',
    ]);
    expect(intervention.value!.data.arguments).not.toContain('do-not-persist-this-command');

    bridge.resolve('codex-command-approval-approval-1', {
      result: { [arguments_.questions[0].question]: 'accept' },
    });
    await expect(responsePromise).resolves.toEqual({ decision: 'accept' });
    await harness.notify('turn/completed', {
      threadId: 'thread-1',
      turn: turn('turn-1', 'completed'),
    });
    await runPromise;
    session.close();

    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          data: expect.objectContaining({
            toolCallId: 'codex-command-approval-approval-1',
          }),
          type: 'tool_start',
        }),
        expect.objectContaining({
          data: expect.objectContaining({
            toolCallId: 'codex-command-approval-approval-1',
          }),
          type: 'tool_result',
        }),
      ]),
    );
  });

  it('fails a forged file-approval label closed as Codex cancel', async () => {
    const harness = createClientHarness({ autoComplete: false });
    const { run, session } = createSession(harness);
    const bridge = new AskUserBridge('operation-1', {
      identifier: 'claude-code',
      provider: 'codex',
    });
    const bridgeEvents = bridge.events()[Symbol.asyncIterator]();
    const runPromise = run('operation-1', 'change a file', bridge);
    await vi.waitFor(() =>
      expect(harness.requests.some(({ method }) => method === 'turn/start')).toBe(true),
    );

    const responsePromise = harness.requestFromServer('item/fileChange/requestApproval', {
      itemId: 'file-1',
      reason: 'needs write access',
      startedAtMs: 1,
      threadId: 'thread-1',
      turnId: 'turn-1',
    });
    const intervention = await bridgeEvents.next();
    const arguments_ = JSON.parse(intervention.value!.data.arguments);
    bridge.resolve('codex-file-approval-file-1', {
      result: {
        [arguments_.questions[0].question]: 'Allow once',
        unexpected: 'accept',
      },
    });

    await expect(responsePromise).resolves.toEqual({ decision: 'cancel' });
    await expect(bridgeEvents.next()).resolves.toMatchObject({
      value: {
        data: { cancelReason: 'user_cancelled', cancelled: true, producerAck: true },
        type: 'agent_intervention_response',
      },
    });
    await harness.notify('turn/completed', {
      threadId: 'thread-1',
      turn: turn('turn-1', 'completed'),
    });
    await runPromise;
    session.close();
  });

  it('rejects an unsupported command-approval amendment without inventing a decision', async () => {
    const harness = createClientHarness({ autoComplete: false });
    const { run, session } = createSession(harness);
    const bridge = new AskUserBridge('operation-1', {
      identifier: 'claude-code',
      provider: 'codex',
    });
    const runPromise = run('operation-1', 'run a command', bridge);
    await vi.waitFor(() =>
      expect(harness.requests.some(({ method }) => method === 'turn/start')).toBe(true),
    );

    await expect(
      harness.requestFromServer('item/commandExecution/requestApproval', {
        availableDecisions: [
          {
            acceptWithExecpolicyAmendment: {
              execpolicy_amendment: ['prefix_rule(pattern=["git", "status"], decision="allow")'],
            },
          },
        ],
        itemId: 'command-1',
        startedAtMs: 1,
        threadId: 'thread-1',
        turnId: 'turn-1',
      }),
    ).rejects.toThrow('Unsupported Codex approval decision variant');

    await harness.notify('turn/completed', {
      threadId: 'thread-1',
      turn: turn('turn-1', 'completed'),
    });
    await runPromise;
    session.close();
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

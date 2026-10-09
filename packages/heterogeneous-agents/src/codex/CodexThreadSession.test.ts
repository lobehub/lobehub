import type { CodexForkTarget } from '@lobechat/types';
import { describe, expect, it, vi } from 'vitest';

import type { UsageData } from '../types';
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
    /** Simulates a Codex build that ignores `lastTurnId` and copies the whole source. */
    forkIgnoresLastTurn?: boolean;
    initialThreadId?: string;
    interruptError?: Error;
    malformedThreadStart?: boolean;
    sourceTurnIds?: string[];
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
        return {
          approvalPolicy: 'never',
          model: 'gpt-5.5-codex',
          cwd: '/workspace',
          sandbox: { type: 'dangerFullAccess' },
          thread: { id: 'thread-1' },
        };
      }
      if (method === 'thread/resume' || method === 'thread/read') {
        if (options.failResume) throw new Error('Thread not found');
        return {
          approvalPolicy: 'never',
          model: 'gpt-5.5-codex',
          cwd: '/workspace',
          sandbox: { type: 'dangerFullAccess' },
          thread: {
            id: options.initialThreadId ?? 'thread-1',
            turns: (options.sourceTurnIds ?? []).map((id) => turn(id, 'completed')),
          },
        };
      }
      if (method === 'thread/fork') {
        const sourceTurnIds = options.sourceTurnIds ?? [];
        const { lastTurnId } = params as { lastTurnId: string };
        const retained = options.forkIgnoresLastTurn
          ? sourceTurnIds
          : sourceTurnIds.slice(0, sourceTurnIds.indexOf(lastTurnId) + 1);
        return {
          approvalPolicy: 'never',
          cwd: '/workspace',
          sandbox: { type: 'dangerFullAccess' },
          model: 'gpt-5.5-codex',
          thread: { id: 'thread-forked', turns: retained.map((id) => turn(id, 'completed')) },
        };
      }
      if (method === 'thread/archive') return {};
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
      registration?.onResume({
        approvalPolicy: 'never',
        model,
        sandbox: { type: 'dangerFullAccess' },
        thread: { id: options.initialThreadId ?? 'thread-1' },
      }),
  };
};

const createSession = (
  harness: ClientHarness,
  options: {
    forkTarget?: CodexForkTarget;
    initialCumulativeUsage?: UsageData;
    initialThreadId?: string;
    onEventsError?: Error;
    threadName?: string;
  } = {},
) => {
  const events: any[] = [];
  const statuses: string[] = [];
  const onSessionId = vi.fn();
  const session = new CodexThreadSession({
    client: harness.client,
    forkTarget: options.forkTarget,
    initialCumulativeUsage: options.initialCumulativeUsage,
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
  // ROOT CAUSE:
  // Editing turn zero starts a fresh thread, but prompt preparation and token
  // accounting previously treated the source resume ID as retained history.
  /** @example First-turn edits receive new-session input and their full usage. */
  it('prepares fresh input and resets usage when forking at the first turn', async () => {
    const harness = createClientHarness({ autoComplete: false, sourceTurnIds: ['source-turn'] });
    const { events, session } = createSession(harness, {
      forkTarget: { position: 'before', threadId: 'source-thread', turnId: 'source-turn' },
      initialThreadId: 'source-thread',
      initialCumulativeUsage: {
        inputCacheMissTokens: 100,
        totalInputTokens: 100,
        totalOutputTokens: 0,
        totalTokens: 100,
      },
    });
    const input = vi.fn(async (isNewSession: boolean) => [
      {
        text: isNewSession ? 'introduction and edited prompt' : 'edited prompt',
        text_elements: [],
        type: 'text' as const,
      },
    ]);
    const run = session.run({ input, operationId: 'edit-first', onRawMessage: vi.fn() });
    await vi.waitFor(() => {
      /** @example Input reaches the real native turn-start boundary. */
      expect(harness.requests.some((request) => request.method === 'turn/start')).toBe(true);
    });
    await harness.notify('turn/started', {
      threadId: 'thread-1',
      turn: turn('turn-1', 'inProgress'),
    });
    await harness.notify('thread/tokenUsage/updated', {
      threadId: 'thread-1',
      tokenUsage: {
        total: {
          inputTokens: 150,
          cachedInputTokens: 0,
          outputTokens: 0,
          reasoningOutputTokens: 0,
          totalTokens: 150,
        },
      },
    });
    await harness.notify('turn/completed', {
      threadId: 'thread-1',
      turn: turn('turn-1', 'completed'),
    });
    await run;
    session.close();
    /** @example The first edited turn carries instructions for a fresh session. */
    expect(input).toHaveBeenCalledWith(true);
    /** @example Source usage is never subtracted from a new native thread. */
    expect(events).toContainEqual(
      expect.objectContaining({
        type: 'step_complete',
        data: expect.objectContaining({
          usage: expect.objectContaining({ totalInputTokens: 150 }),
        }),
      }),
    );
  });

  // ROOT CAUSE:
  // A retained-prefix fork copied source-tip cumulative usage, including later turns.
  // The child's native total still includes only retained history, so subtracting
  // the tip either undercounts or charges all inherited tokens after a counter reset.
  // Rebase from the first native total/last pair, then accumulate all child steps.
  /** @example Both counter relationships exclude unrelated later source turns. */
  it.each([140, 350])(
    'rebases retained fork usage when the first child total is %i',
    async (firstTotal) => {
      const harness = createClientHarness({
        autoComplete: false,
        sourceTurnIds: ['retained', 'later'],
      });
      const { events, session } = createSession(harness, {
        forkTarget: { position: 'after', threadId: 'source-thread', turnId: 'retained' },
        initialThreadId: 'source-thread',
        initialCumulativeUsage: {
          inputCacheMissTokens: 300,
          totalInputTokens: 300,
          totalOutputTokens: 0,
          totalTokens: 300,
        },
      });
      const run = session.run({ input: [], operationId: 'fork-usage', onRawMessage: vi.fn() });
      await vi.waitFor(() => {
        /** @example Usage is observed only after the child starts its native turn. */
        expect(harness.requests.some((request) => request.method === 'turn/start')).toBe(true);
      });
      await harness.notify('turn/started', {
        threadId: 'thread-1',
        turn: turn('turn-1', 'inProgress'),
      });
      for (const [total, last] of [
        [firstTotal, firstTotal - 100],
        [firstTotal + 20, 20],
      ]) {
        await harness.notify('thread/tokenUsage/updated', {
          threadId: 'thread-1',
          turnId: 'turn-1',
          tokenUsage: {
            total: {
              inputTokens: total,
              cachedInputTokens: 0,
              outputTokens: 0,
              reasoningOutputTokens: 0,
              totalTokens: total,
            },
            last: {
              inputTokens: last,
              cachedInputTokens: 0,
              outputTokens: 0,
              reasoningOutputTokens: 0,
              totalTokens: last,
            },
          },
        });
      }
      await harness.notify('turn/completed', {
        threadId: 'thread-1',
        turn: turn('turn-1', 'completed'),
      });
      await run;
      /** @example Both new steps are billed once; the retained 100 tokens are excluded. */
      expect(events).toContainEqual(
        expect.objectContaining({
          type: 'step_complete',
          data: expect.objectContaining({
            usage: expect.objectContaining({ totalInputTokens: firstTotal - 100 + 20 }),
          }),
        }),
      );
      session.close();
    },
  );

  // ROOT CAUSE:
  // Re-entering ensureThread after a disconnect reused the original fork boundary against
  // the child. Consuming the fork target once makes subsequent connections resume the child.
  /** @example A completed child reconnects without forking its original boundary again. */
  it('resumes the child after a forked session disconnects', async () => {
    const harness = createClientHarness({
      initialThreadId: 'thread-source',
      sourceTurnIds: ['turn-a', 'turn-b'],
    });
    const { run, session } = createSession(harness, {
      initialThreadId: 'thread-source',
      forkTarget: { position: 'after', threadId: 'thread-source', turnId: 'turn-a' },
    });
    await run('operation-1', 'First child prompt');
    harness.disconnect();
    await run('operation-2', 'Continue child');
    session.close();
    expect(harness.requests.filter(({ method }) => method === 'thread/fork')).toHaveLength(1);
    expect(harness.requests).toContainEqual({
      method: 'thread/resume',
      params: expect.objectContaining({ threadId: 'thread-forked' }),
    });
  });

  it('forks a resumed thread at an exact turn boundary before starting the next turn', async () => {
    const harness = createClientHarness({
      initialThreadId: 'thread-source',
      sourceTurnIds: ['turn-a', 'turn-b', 'turn-c'],
    });
    const { onSessionId, run, session } = createSession(harness, {
      forkTarget: { position: 'after', threadId: 'thread-source', turnId: 'turn-b' },
      initialThreadId: 'thread-source',
      threadName: 'Forked work',
    });

    await run('operation-1', 'take another approach');
    session.close();

    expect(harness.requests.slice(0, 4)).toEqual([
      {
        method: 'thread/read',
        params: { includeTurns: true, threadId: 'thread-source' },
      },
      {
        method: 'thread/fork',
        params: expect.objectContaining({ lastTurnId: 'turn-b', threadId: 'thread-source' }),
      },
      {
        method: 'thread/name/set',
        params: { name: 'Forked work', threadId: 'thread-forked' },
      },
      {
        method: 'turn/start',
        params: expect.objectContaining({ threadId: 'thread-forked' }),
      },
    ]);
    expect(onSessionId).toHaveBeenCalledWith('thread-forked');
  });

  // ROOT CAUSE:
  // The fork trusted `lastTurnId` blindly. A Codex build that ignored it would hand the
  // branch every later source turn while the UI showed the shorter history.
  /** @example A child that retained later turns is archived and never runs a prompt. */
  it('archives and rejects a fork whose history passes the requested turn', async () => {
    const harness = createClientHarness({
      forkIgnoresLastTurn: true,
      initialThreadId: 'thread-source',
      sourceTurnIds: ['turn-a', 'turn-b', 'turn-c'],
    });
    const { onSessionId, run, session } = createSession(harness, {
      forkTarget: { position: 'after', threadId: 'thread-source', turnId: 'turn-a' },
      initialThreadId: 'thread-source',
    });

    await expect(run('operation-1', 'branch prompt')).rejects.toThrow(
      'Codex fork ended at turn turn-c instead of turn-a',
    );
    session.close();

    expect(harness.requests.map(({ method }) => method)).toEqual([
      'thread/read',
      'thread/fork',
      'thread/archive',
    ]);
    expect(onSessionId).not.toHaveBeenCalled();
  });

  it('starts a clean thread when a forked first turn keeps no history', async () => {
    const harness = createClientHarness({
      initialThreadId: 'thread-source',
      sourceTurnIds: ['turn-a'],
    });
    const { run, session } = createSession(harness, {
      forkTarget: { position: 'before', threadId: 'thread-source', turnId: 'turn-a' },
      initialThreadId: 'thread-source',
    });

    await run('operation-1', 'edited first prompt');
    session.close();

    expect(harness.requests.map(({ method }) => method)).toEqual([
      'thread/read',
      'thread/start',
      'turn/start',
    ]);
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

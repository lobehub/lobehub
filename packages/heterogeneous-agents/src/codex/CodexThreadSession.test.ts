import type { CodexForkTarget } from '@lobechat/types';
import { describe, expect, it, vi } from 'vitest';

import type { UsageData } from '../types';
import type { CodexApprovalDecision } from './CodexApprovalBridge';
import {
  CodexAppServerClient,
  CodexAppServerConnectionError,
  CodexAppServerRpcError,
  isCodexAppServerCompatibilityError,
} from './CodexAppServerClient';
import { CodexThreadSession } from './CodexThreadSession';
import type { ApprovalsReviewer } from './protocol';

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
  requestApproval: (method: string, params: unknown) => Promise<unknown> | undefined;
  requests: Array<{ method: string; params: unknown }>;
  resolveThreadStart: () => void;
  resolveTurnStart: () => void;
  resume: (model?: string) => Promise<void> | void;
}

const createClientHarness = (
  options: {
    activeResume?: boolean;
    approvalsReviewer?: ApprovalsReviewer;
    autoComplete?: boolean;
    delayThreadStart?: boolean;
    delayTurnStart?: boolean;
    disconnectOnInterrupt?: boolean;
    connectError?: Error;
    failResume?: boolean;
    initialThreadId?: string;
    interruptError?: Error;
    malformedThreadStart?: boolean;
    sourceTurnIds?: string[];
    permissionMismatch?: boolean;
    expandedSandbox?: boolean;
    threadNameError?: Error;
  } = {},
): ClientHarness => {
  let disconnectHandler: (() => void) | undefined;
  let notificationHandler: ((method: string, params: unknown) => Promise<void>) | undefined;
  let serverRequestHandler: ((method: string, params: unknown) => Promise<unknown>) | undefined;
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
        return {
          approvalPolicy: options.expandedSandbox ? 'on-request' : 'never',
          approvalsReviewer: options.approvalsReviewer ?? 'user',
          model: 'gpt-5.5-codex',
          cwd: '/workspace',
          sandbox: options.expandedSandbox
            ? {
                type: 'workspaceWrite',
                networkAccess: true,
                writableRoots: ['/outside'],
                excludeTmpdirEnvVar: false,
                excludeSlashTmp: false,
              }
            : { type: options.permissionMismatch ? 'readOnly' : 'dangerFullAccess' },
          thread: { id: 'thread-1' },
        };
      }
      if (method === 'thread/resume' || method === 'thread/read') {
        if (options.failResume) throw new Error('Thread not found');
        return {
          approvalPolicy: options.expandedSandbox ? 'on-request' : 'never',
          approvalsReviewer: options.approvalsReviewer ?? 'user',
          model: 'gpt-5.5-codex',
          cwd: '/workspace',
          sandbox: options.expandedSandbox
            ? {
                type: 'workspaceWrite',
                networkAccess: true,
                writableRoots: ['/outside'],
                excludeTmpdirEnvVar: false,
                excludeSlashTmp: false,
              }
            : { type: options.permissionMismatch ? 'readOnly' : 'dangerFullAccess' },
          thread: {
            id: options.initialThreadId ?? 'thread-1',
            turns: (options.sourceTurnIds ?? []).map((id) => turn(id, 'completed')),
            status: { type: options.activeResume ? 'active' : 'idle' },
          },
        };
      }
      if (method === 'thread/fork') {
        return {
          approvalPolicy: 'never',
          approvalsReviewer: 'user',
          cwd: '/workspace',
          sandbox: { type: options.permissionMismatch ? 'readOnly' : 'dangerFullAccess' },
          model: 'gpt-5.5-codex',
          thread: { id: 'thread-forked' },
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
    subscribeServerRequests: vi.fn((_threadId: string, handler: typeof serverRequestHandler) => {
      serverRequestHandler = handler;
      return vi.fn();
    }),
  };

  return {
    client,
    disconnect: () => disconnectHandler?.(),
    notify,
    requestApproval: (method, params) => serverRequestHandler?.(method, params),
    registeredResumeParams: () => resumeParams,
    releaseConsumer,
    requests,
    resolveThreadStart,
    resolveTurnStart,
    resume: (model = 'gpt-5.5-codex') =>
      registration?.onResume({
        approvalPolicy: 'never',
        approvalsReviewer: options.approvalsReviewer ?? 'user',
        model,
        sandbox: { type: options.permissionMismatch ? 'readOnly' : 'dangerFullAccess' },
        thread: { id: options.initialThreadId ?? 'thread-1' },
      }),
  };
};

const createSession = (
  harness: ClientHarness,
  options: {
    forkTarget?: CodexForkTarget;
    initialCumulativeUsage?: UsageData;
    allowExecFallback?: boolean;
    approvalsReviewer?: ApprovalsReviewer;
    initialThreadId?: string;
    onEventsError?: Error;
    threadName?: string;
  } = {},
) => {
  const events: any[] = [];
  const statuses: string[] = [];
  const onSessionId = vi.fn();
  const session = new CodexThreadSession({
    allowExecFallback: options.allowExecFallback,
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
      approvalsReviewer: options.approvalsReviewer ?? 'user',
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
  //
  // Fork creation used the immutable constructor parameters instead of the
  // current run parameters. Both child paths consequently lost request IDs.
  // Pass the run's threadParams to thread/start and thread/fork.
  /** @example Editing turn zero forwards this run's three request identifiers. */
  it('passes current request context to an edited first turn', async () => {
    const harness = createClientHarness({ sourceTurnIds: ['source-turn'] });
    const { session } = createSession(harness, {
      forkTarget: { position: 'before', threadId: 'source-thread', turnId: 'source-turn' },
      initialThreadId: 'source-thread',
    });
    const env = {
      LOBEHUB_AGENT_ID: 'agent-edit',
      LOBEHUB_OPERATION_ID: 'operation-edit',
      LOBEHUB_TOPIC_ID: 'topic-edit',
    };
    try {
      await session.run({ env, input: [], onRawMessage: vi.fn(), operationId: 'operation-edit' });
      /** @example A new edited child receives current IDs through its shell policy. */
      expect(harness.requests.find(({ method }) => method === 'thread/start')).toMatchObject({
        params: { config: Object.fromEntries(Object.entries(env).map(([key, value]) => [
          `shell_environment_policy.set.${key}`, value,
        ])) },
      });
    } finally {
      session.close();
    }
  });

  /** @example Retained-history forks forward this run's three request identifiers. */
  it('passes current request context to a retained-history fork', async () => {
    const harness = createClientHarness({
      initialThreadId: 'thread-forked',
      sourceTurnIds: ['source-turn'],
    });
    const { session } = createSession(harness, {
      forkTarget: { position: 'after', threadId: 'source-thread', turnId: 'source-turn' },
      initialThreadId: 'source-thread',
    });
    const env = {
      LOBEHUB_AGENT_ID: 'agent-fork',
      LOBEHUB_OPERATION_ID: 'operation-fork',
      LOBEHUB_TOPIC_ID: 'topic-fork',
    };
    try {
      await session.run({ env, input: [], onRawMessage: vi.fn(), operationId: 'operation-fork' });
      /** @example A fork receives current IDs instead of the source's request context. */
      expect(harness.requests.find(({ method }) => method === 'thread/fork')).toMatchObject({
        params: { config: Object.fromEntries(Object.entries(env).map(([key, value]) => [
          `shell_environment_policy.set.${key}`, value,
        ])) },
      });
    } finally {
      session.close();
    }
  });

  // ROOT CAUSE:
  //
  // Acquiring the constructor's initialThreadId claimed the fork source, which
  // may already have a live owner. Claim only the created child at attachment.
  /** @example A live source remains owned while a fork claims and releases only its child. */
  it('preserves source ownership and releases only the fork child on close', async () => {
    const client = new CodexAppServerClient({
      clientVersion: 'test',
      commandPath: 'unused',
      cwd: '/workspace',
      env: process.env,
    });
    const releaseSource = client.acquireThread('source-thread');
    const harness = createClientHarness({
      initialThreadId: 'thread-forked',
      sourceTurnIds: ['source-turn'],
    });
    harness.client.acquireThread = (threadId: string) => client.acquireThread(threadId);
    const { session } = createSession(harness, {
      forkTarget: { position: 'after', threadId: 'source-thread', turnId: 'source-turn' },
      initialThreadId: 'source-thread',
    });
    try {
      await session.run({ input: [], onRawMessage: vi.fn(), operationId: 'operation-fork' });
      /** @example An attached child cannot be acquired by a second live owner. */
      expect(() => client.acquireThread('thread-forked')).toThrow();
      session.close();
      /** @example Closing the child does not release the live source. */
      expect(() => client.acquireThread('source-thread')).toThrow();
      const releaseChild = client.acquireThread('thread-forked');
      releaseChild();
    } finally {
      session.close();
      releaseSource();
      client.close();
    }
  });

  // ROOT CAUSE:
  // The edit/fork branches attach a child before reaching the normal permission check.
  // Combining native forks with permission verification must guard every child creation.
  /** @example An edited first turn cannot start under a mismatched permission profile. */
  it('rejects mismatched permissions before an edited first turn starts', async () => {
    const harness = createClientHarness({
      permissionMismatch: true,
      sourceTurnIds: ['source-turn'],
    });
    const { run, session } = createSession(harness, {
      forkTarget: { position: 'before', threadId: 'source', turnId: 'source-turn' },
      initialThreadId: 'source',
    });
    try {
      /** @example Native permission mismatch is rejected before any user prompt executes. */
      await expect(run('edit', 'edited')).rejects.toThrow();
      /** @example No turn reaches the native runtime with the wrong permissions. */
      expect(harness.requests.some(({ method }) => method === 'turn/start')).toBe(false);
    } finally {
      session.close();
    }
  });

  /** @example A forked child must preserve the configured permission profile. */
  it('rejects mismatched permissions before a forked child starts', async () => {
    const harness = createClientHarness({
      permissionMismatch: true,
      sourceTurnIds: ['source-turn'],
    });
    const { run, session } = createSession(harness, {
      forkTarget: { position: 'after', threadId: 'source', turnId: 'source-turn' },
      initialThreadId: 'source',
    });
    try {
      /** @example Fork response policy is checked just like start and resume responses. */
      await expect(run('fork', 'child')).rejects.toThrow();
      /** @example A rejected fork never executes the user prompt. */
      expect(harness.requests.some(({ method }) => method === 'turn/start')).toBe(false);
    } finally {
      session.close();
    }
  });

  // ROOT CAUSE:
  // Editing turn zero starts a fresh thread, but prompt preparation and token
  // accounting previously treated the source resume ID as retained history.
  /** @example First-turn edits receive new-session input and their full usage. */
  it('prepares fresh input and resets usage when editing the first turn', async () => {
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

  it('starts a clean thread when an edited first turn keeps no history', async () => {
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

  /** @example Changing operation after disconnect must invalidate queued old resume parameters. */
  it('replaces detached reconnect context before starting the next operation', async () => {
    // ROOT CAUSE:
    // Disconnect marks the thread detached while keeping its automatic-resume registration.
    // Checking attached before unregistering allowed reconnect to restore the previous env.
    // Context changes now invalidate that registration before awaiting connect.
    const harness = createClientHarness();
    const { session } = createSession(harness);
    const run = (operationId: string) =>
      session.run({
        env: { LOBEHUB_OPERATION_ID: operationId },
        input: [],
        onRawMessage: () => {},
        operationId,
      });
    try {
      await run('old');
      harness.disconnect();
      harness.client.connect.mockImplementationOnce(async () => {
        await harness.resume();
      });
      await run('new');
      const resume = harness.requests.filter(({ method }) => method === 'thread/resume');
      /** @example A new cold resume sends the current operation after recovery completes. */
      expect(resume.at(-1)?.params).toMatchObject({
        config: { 'shell_environment_policy.set.LOBEHUB_OPERATION_ID': 'new' },
      });
      /** @example A later process restart also uses the current operation. */
      expect(harness.registeredResumeParams()).toMatchObject({
        config: { 'shell_environment_policy.set.LOBEHUB_OPERATION_ID': 'new' },
      });
    } finally {
      session.close();
    }
  });

  /** @example Closing during unsubscribe must not reload a native thread now owned by another session. */
  it('does not resume after closing during an unsubscribe request', async () => {
    // ROOT CAUSE:
    // close releases the native-thread claim while an unsubscribe RPC may still be pending.
    // Continuing to resume could replace a new owner's shell context with the old run's IDs.
    // Recheck closed state immediately after unsubscribe before sending another RPC.
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
    const run = session.run({
      env: { LOBEHUB_OPERATION_ID: 'old' },
      input: [],
      onRawMessage: () => {},
      operationId: 'old',
    });
    try {
      /** @example Close precisely while the native unsubscribe is pending. */
      await vi.waitFor(() =>
        expect(harness.client.request).toHaveBeenCalledWith('thread/unsubscribe', {
          threadId: 'existing',
        }),
      );
      session.close();
      release();
      await run;
      /** @example The closed owner cannot send resume or start a turn. */
      expect(harness.requests.map(({ method }) => method)).toEqual(['thread/unsubscribe']);
    } finally {
      release();
      session.close();
      await run;
    }
  });

  /** @example A previous turn still shutting down cannot silently retain its old shell context. */
  it('fails safely instead of starting a turn when resume is still active', async () => {
    const harness = createClientHarness({ activeResume: true, initialThreadId: 'thread-existing' });
    const { session } = createSession(harness, { initialThreadId: 'thread-existing' });
    try {
      /** @example The run reports a retryable boundary instead of executing under stale context. */
      await expect(
        session.run({
          env: { LOBEHUB_OPERATION_ID: 'new' },
          input: [],
          onRawMessage: () => {},
          operationId: 'new',
        }),
      ).rejects.toThrow('previous turn is still active');
      /** @example Native-thread failures must not replay the prompt through exec. */
      expect(session.canFallbackToExec).toBe(false);
      /** @example No model turn starts after the unsafe resume. */
      expect(harness.requests.some(({ method }) => method === 'turn/start')).toBe(false);
    } finally {
      session.close();
    }
  });

  /** @example Later operations reload the native thread with their own shell provenance. */
  it('updates shell provenance on resume while preserving other thread config', async () => {
    // ROOT CAUSE:
    // The process env belongs to the first run, and loaded-thread resume ignores config overrides.
    // Send provenance in thread config and unsubscribe the idle thread before changing it.
    const harness = createClientHarness();
    const { session } = createSession(harness);
    const run = (operationId: string) =>
      session.run({
        input: [{ type: 'text', text: 'hello', text_elements: [] }],
        onRawMessage: () => {},
        operationId,
        env: {
          LOBEHUB_AGENT_ID: 'agent',
          LOBEHUB_TOPIC_ID: 'topic',
          LOBEHUB_OPERATION_ID: operationId,
        },
      });
    try {
      await run('op-a');
      await run('op-b');
      const requests = harness.requests.filter(({ method }) =>
        ['thread/start', 'thread/unsubscribe', 'thread/resume'].includes(method),
      );
      /** @example The second run releases the server subscription before applying new config. */
      expect(requests.map(({ method }) => method)).toEqual([
        'thread/start',
        'thread/unsubscribe',
        'thread/resume',
      ]);
      /** @example A resumed shell receives op-b, never op-a. */
      expect(requests.at(-1)?.params).toMatchObject({
        config: {
          'shell_environment_policy.set.LOBEHUB_OPERATION_ID': 'op-b',
          'shell_environment_policy.set.LOBEHUB_TOPIC_ID': 'topic',
        },
      });
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
          approvalsReviewer: 'user',
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
          approvalsReviewer: 'user',
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
      approvalsReviewer: 'user',
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

  /**
   * @example Ask cannot accept a native response that widens network or filesystem scope.
   */
  it('rejects expanded native sandbox scope before starting a turn', async () => {
    // ROOT CAUSE:
    //
    // Comparing only the sandbox variant allowed inherited writable roots/network access.
    // The requested Ask preset now constrains those settings and validates the echoed scope.
    const harness = createClientHarness({ expandedSandbox: true });
    const session = new CodexThreadSession({
      allowExecFallback: false,
      client: harness.client,
      onEvents: vi.fn(),
      onRuntimeStatus: vi.fn(),
      onSessionId: vi.fn(),
      sessionId: 'scope-test',
      threadParams: {
        approvalPolicy: 'on-request',
        approvalsReviewer: 'user',
        config: { 'sandbox_workspace_write.network_access': false },
        cwd: '/workspace',
        sandbox: 'workspace-write',
      },
    });
    await expect(
      session.run({
        input: [{ type: 'text', text: 'start', text_elements: [] }],
        onRawMessage: vi.fn(),
        operationId: 'scope-operation',
      }),
    ).rejects.toThrow('Codex app-server did not apply the requested permission profile');
    expect(harness.requests.some(({ method }) => method === 'turn/start')).toBe(false);
    expect(session.canFallbackToExec).toBe(false);
    session.close();
  });

  // ROOT CAUSE:
  //
  // Codex accepts guardian_subagent but serializes the same reviewer as auto_review.
  // Literal equality rejected this unchanged permission before any turn could start.
  // Compare only these protocol aliases as equivalent; user remains a distinct reviewer.
  /** @example Native start and resume accept either spelling of the same automatic reviewer. */
  it.each([
    ['guardian_subagent', 'auto_review', undefined],
    ['auto_review', 'guardian_subagent', undefined],
    ['guardian_subagent', 'auto_review', 'thread-existing'],
    ['auto_review', 'guardian_subagent', 'thread-existing'],
  ] as const)(
    'accepts reviewer %s echoed as %s for %s',
    async (expected, actual, initialThreadId) => {
      const harness = createClientHarness({ approvalsReviewer: actual, initialThreadId });
      const { run, session } = createSession(harness, {
        allowExecFallback: false,
        approvalsReviewer: expected,
        initialThreadId,
      });
      try {
        /** @example The unchanged automatic reviewer permits the native turn. */
        await expect(run('alias-start', 'start')).resolves.toBeUndefined();
        /** @example Outgoing RPC still preserves the user's exact reviewer spelling. */
        expect(harness.requests[0]).toMatchObject({ params: { approvalsReviewer: expected } });
        /** @example Reconnection applies the same alias-aware permission check. */
        await expect(Promise.resolve(harness.resume())).resolves.toBeUndefined();
        /** @example The reattached native session can run its next turn. */
        await expect(run('alias-next', 'continue')).resolves.toBeUndefined();
      } finally {
        session.close();
      }
    },
  );

  /** @example Human and automatic review are never interchangeable. */
  it.each([
    ['guardian_subagent', 'user', undefined],
    ['user', 'guardian_subagent', undefined],
    ['guardian_subagent', 'user', 'thread-existing'],
    ['user', 'guardian_subagent', 'thread-existing'],
  ] as const)(
    'rejects reviewer %s changed to %s for %s',
    async (expected, actual, initialThreadId) => {
      const harness = createClientHarness({ approvalsReviewer: actual, initialThreadId });
      const { run, session } = createSession(harness, {
        allowExecFallback: false,
        approvalsReviewer: expected,
        initialThreadId,
      });
      try {
        /** @example A reviewer change still fails before native execution. */
        await expect(run('reviewer-mismatch', 'start')).rejects.toThrow(
          'Codex app-server did not apply the requested permission profile',
        );
        /** @example No turn starts under a different approval reviewer. */
        expect(harness.requests.some(({ method }) => method === 'turn/start')).toBe(false);
        /** @example A reviewer mismatch cannot downgrade the run to exec. */
        expect(session.canFallbackToExec).toBe(false);
      } finally {
        session.close();
      }
    },
  );

  it('fails closed when app-server echoes a different permission profile', async () => {
    const harness = createClientHarness({ permissionMismatch: true });
    const { run, session } = createSession(harness, { allowExecFallback: false });

    await expect(run('operation-1', 'start')).rejects.toThrow(
      'Codex app-server did not apply the requested permission profile',
    );
    expect(session.canFallbackToExec).toBe(false);
    session.close();
  });

  it.each([
    [
      'item/commandExecution/requestApproval',
      {
        approvalId: 'approval-1',
        availableDecisions: [
          'accept',
          {
            acceptWithExecpolicyAmendment: {
              execpolicy_amendment: ['/usr/bin/curl', '-I', 'https://github.com'],
            },
          },
          'cancel',
        ],
        itemId: 'item-1',
      },
      'approval-1',
      'command_execution',
      {
        acceptWithExecpolicyAmendment: {
          execpolicy_amendment: ['/usr/bin/curl', '-I', 'https://github.com'],
        },
      } satisfies CodexApprovalDecision,
    ],
    [
      'item/fileChange/requestApproval',
      { itemId: 'item-1' },
      'item-1',
      'file_change',
      'acceptForSession' as const satisfies CodexApprovalDecision,
    ],
  ])(
    'bridges %s requests to an intervention decision',
    async (method, params, _nativeId, apiName, decision) => {
      const harness = createClientHarness({ autoComplete: false });
      const { events, run, session } = createSession(harness);
      const running = run('operation-1', 'start');
      await vi.waitFor(() =>
        expect(harness.requests.some(({ method }) => method === 'turn/start')).toBe(true),
      );

      const approval = harness.requestApproval(method, {
        ...params,
        threadId: 'thread-1',
        turnId: 'turn-1',
      });
      await vi.waitFor(() =>
        expect(events).toContainEqual(
          expect.objectContaining({
            data: expect.objectContaining({
              apiName,
              interventionId: expect.any(String),
              toolCallId: 'item-1',
            }),
            operationId: 'operation-1',
            type: 'agent_intervention_request',
          }),
        ),
      );
      const intervention = events.find((event) => event.type === 'agent_intervention_request');
      expect(JSON.parse(intervention!.data.arguments)).toMatchObject(params);
      expect(
        session.resolveApproval('operation-1', intervention!.data.interventionId, decision),
      ).toBe(true);
      await expect(approval).resolves.toEqual({ decision });

      await harness.notify('turn/completed', {
        threadId: 'thread-1',
        turn: turn('turn-1', 'completed'),
      });
      await running;
      session.close();
    },
  );

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

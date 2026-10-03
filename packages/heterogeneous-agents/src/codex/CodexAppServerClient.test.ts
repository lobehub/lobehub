import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  CodexAppServerClient,
  CodexAppServerConnectionError,
  CodexAppServerRpcError,
  isCodexAppServerCompatibilityError,
} from './CodexAppServerClient';

const { resolveCliSpawnPlanMock, spawnMock } = vi.hoisted(() => ({
  resolveCliSpawnPlanMock: vi.fn(),
  spawnMock: vi.fn(),
}));

vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, spawn: spawnMock };
});

vi.mock('../spawn/cliSpawn', () => ({ resolveCliSpawnPlan: resolveCliSpawnPlanMock }));

interface RpcMessage {
  id?: number | string;
  method?: string;
  params?: Record<string, unknown>;
  result?: unknown;
}

const createProcess = (
  options: {
    exitAfterResume?: boolean;
    exitOnResume?: boolean;
    rejectInitializeCode?: number;
    throwOnMethod?: string;
  } = {},
) => {
  const child = new EventEmitter() as any;
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  const messages: RpcMessage[] = [];
  const send = (message: Record<string, unknown>) => stdout.write(`${JSON.stringify(message)}\n`);

  child.pid = 987_654;
  child.killed = false;
  child.stdout = stdout;
  child.stderr = stderr;
  child.kill = vi.fn(() => true);
  child.stdin = {
    on: vi.fn(),
    write: vi.fn((line: string) => {
      const message = JSON.parse(line) as RpcMessage;
      if (options.throwOnMethod && message.method === options.throwOnMethod) {
        throw new Error('stdin write failed');
      }
      messages.push(message);
      queueMicrotask(() => {
        if (message.method === 'initialize') {
          if (options.rejectInitializeCode) {
            send({
              error: { code: options.rejectInitializeCode, message: 'Initialize failed' },
              id: message.id,
            });
          } else {
            const response = `${JSON.stringify({
              id: message.id,
              result: {
                codexHome: '/tmp/codex',
                platformFamily: 'unix',
                platformOs: 'linux',
                userAgent: 'codex-test',
              },
            })}\n`;
            stdout.write(response.slice(0, 9));
            stdout.write(response.slice(9));
          }
        }
        if (message.method === 'thread/start') {
          send({ id: message.id, result: { thread: { id: 'thread-1' } } });
          send({
            method: 'turn/started',
            params: { threadId: 'thread-1', turn: { id: 'turn-1' } },
          });
          send({
            id: 'approval-1',
            method: 'item/commandExecution/requestApproval',
            params: { itemId: 'command-1', threadId: 'thread-1', turnId: 'turn-1' },
          });
        }
        if (message.method === 'thread/resume') {
          if (options.exitOnResume) {
            child.emit('exit', 1, null);
            return;
          }
          send({
            id: message.id,
            result: { model: 'gpt-5.5-codex', thread: { id: 'thread-1' } },
          });
          if (options.exitAfterResume) child.emit('exit', 1, null);
        }
      });
      return true;
    }),
  };

  return { child, messages, send, stderr, stdout };
};

const createClient = (
  options: {
    reconnectBaseDelayMs?: number;
    reconnectMaxAttempts?: number;
    reconnectMaxDelayMs?: number;
  } = {},
) =>
  new CodexAppServerClient({
    clientVersion: '1.0.0',
    commandPath: 'codex',
    cwd: '/workspace',
    env: process.env,
    ...options,
  });

beforeEach(() => {
  resolveCliSpawnPlanMock.mockImplementation(async (command: string, args: string[]) => ({
    args,
    command,
  }));
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  resolveCliSpawnPlanMock.mockReset();
  spawnMock.mockReset();
});

describe('CodexAppServerClient', () => {
  /** @example A second session cannot unsubscribe a native thread owned by the first one. */
  it('claims native threads synchronously and releases ownership idempotently', () => {
    const client = createClient();
    const releaseFirst = client.acquireThread('thread-shared');
    /** @example Concurrent resume is rejected before any asynchronous RPC. */
    expect(() => client.acquireThread('thread-shared')).toThrow('already has an active session');
    releaseFirst();
    const releaseSecond = client.acquireThread('thread-shared');
    releaseFirst();
    /** @example An old cleanup cannot release the next session owner. */
    expect(() => client.acquireThread('thread-shared')).toThrow('already has an active session');
    releaseSecond();
    client.close();
  });

  /** @example Reused and restarted processes cannot retain a previous run identity. */
  it('omits request provenance from the spawned process without dropping credentials', async () => {
    // ROOT CAUSE:
    // Ignoring provenance only in canReuseFor still launches child tools with the first run IDs.
    // Strip these IDs from the shared process and provide them in the owning thread instead.
    const proc = createProcess();
    spawnMock.mockReturnValue(proc.child);
    const env = Object.freeze({
      ...process.env,
      CODEX_HOME: '/codex',
      LOBEHUB_JWT: 'test-token',
      LOBEHUB_AGENT_ID: 'agent-a',
      LOBEHUB_TOPIC_ID: 'topic-a',
      LOBEHUB_OPERATION_ID: 'op-a',
    });
    const client = new CodexAppServerClient({
      clientVersion: 'test',
      commandPath: 'codex',
      cwd: '/workspace',
      env,
    });
    try {
      await client.connect();
      const spawnedEnv = spawnMock.mock.calls[0][2].env;
      /** @example Credentials remain guarded while all three provenance values are absent. */
      expect({
        agent: spawnedEnv.LOBEHUB_AGENT_ID,
        operation: spawnedEnv.LOBEHUB_OPERATION_ID,
        topic: spawnedEnv.LOBEHUB_TOPIC_ID,
        token: spawnedEnv.LOBEHUB_JWT,
      }).toEqual({ agent: undefined, operation: undefined, topic: undefined, token: 'test-token' });
      /** @example The callers environment remains immutable. */
      expect(env.LOBEHUB_OPERATION_ID).toBe('op-a');
    } finally {
      client.close();
    }
  });

  /** @example Two concurrent topics can reuse a process with identical credentials. */
  it('ignores only the exact three request provenance keys', () => {
    const options = {
      clientVersion: 'test',
      commandPath: 'codex',
      cwd: '/workspace',
      env: {
        ...process.env,
        CODEX_HOME: '/codex',
        LOBEHUB_AGENT_ID: 'a',
        LOBEHUB_TOPIC_ID: 't',
        LOBEHUB_OPERATION_ID: 'o',
        LOBEHUB_JWT: 'token',
      },
    };
    const client = new CodexAppServerClient(options);
    /** @example Agent and topic provenance can change along with the operation ID. */
    expect(
      client.canReuseFor({
        ...options,
        env: {
          ...options.env,
          LOBEHUB_AGENT_ID: 'b',
          LOBEHUB_TOPIC_ID: 'u',
          LOBEHUB_OPERATION_ID: 'p',
        },
      }),
    ).toBe(true);
    /** @example A similarly named process setting is still significant. */
    expect(
      client.canReuseFor({
        ...options,
        env: { ...options.env, LOBEHUB_TOPIC_ID_EXTRA: 'different' },
      }),
    ).toBe(false);
  });

  /**
   * @example Two active operations share a process when only their correlation ID differs.
   */
  it('reuses an active process when only the operation ID changes', () => {
    // ROOT CAUSE:
    //
    // Every run injects LOBEHUB_OPERATION_ID into its launch environment.
    // Comparing the entire environment treated that request ID as process configuration,
    // so the controller rejected a second operation while the first still had a consumer.
    // Ignoring request provenance while retaining every process setting preserves that guard.
    const options = {
      args: ['--config', 'model_provider="openai"'],
      clientVersion: '1.0.0',
      commandPath: 'codex',
      cwd: '/workspace',
      env: { ...process.env, CODEX_HOME: '/codex', LOBEHUB_OPERATION_ID: 'operation-1' },
    };
    const client = new CodexAppServerClient(options);
    const release = client.acquireConsumer();

    try {
      /** @example An active consumer does not prevent a compatible second operation. */
      expect({
        hasConsumers: client.hasConsumers,
        reusable: client.canReuseFor({
          ...options,
          env: { ...options.env, LOBEHUB_OPERATION_ID: 'operation-2' },
        }),
      }).toEqual({ hasConsumers: true, reusable: true });

      /** @example Ignoring operation IDs must not hide a changed Codex home. */
      expect(
        client.canReuseFor({
          ...options,
          env: {
            ...options.env,
            CODEX_HOME: '/other-codex',
            LOBEHUB_OPERATION_ID: 'operation-2',
          },
        }),
      ).toBe(false);
    } finally {
      release();
      client.close();
    }
  });

  /**
   * @example Adding, removing, or leaving the operation ID undefined is compatible in either direction.
   */
  it('ignores operation ID presence without mutating the launch environment', () => {
    const baseEnv = { ...process.env };
    delete baseEnv.LOBEHUB_OPERATION_ID;
    const environments: NodeJS.ProcessEnv[] = [
      { ...baseEnv, CODEX_HOME: '/codex' },
      { ...baseEnv, CODEX_HOME: '/codex', LOBEHUB_OPERATION_ID: undefined },
      { ...baseEnv, CODEX_HOME: '/codex', LOBEHUB_OPERATION_ID: '' },
      { ...baseEnv, CODEX_HOME: '/codex', LOBEHUB_OPERATION_ID: 'operation-1' },
    ];
    const options = { clientVersion: '1.0.0', commandPath: 'codex', cwd: '/workspace' };

    const compatibility = environments.map((env) => {
      const client = new CodexAppServerClient({ ...options, env: Object.freeze(env) });
      try {
        return environments.map((nextEnv) => client.canReuseFor({ ...options, env: nextEnv }));
      } finally {
        client.close();
      }
    });

    /** @example Every combination differs only in the ignored request ID. */
    expect(compatibility).toEqual(environments.map(() => environments.map(() => true)));
  });

  /**
   * @example A second operation cannot change credentials or add/remove process configuration.
   */
  it('still rejects incompatible environment changes while another operation is active', () => {
    const options = {
      clientVersion: '1.0.0',
      commandPath: 'codex',
      cwd: '/workspace',
      env: {
        ...process.env,
        CODEX_HOME: '/codex',
        LOBEHUB_JWT: 'test-credential-a',
        LOBEHUB_OPERATION_ID: 'operation-1',
      },
    };
    const client = new CodexAppServerClient(options);
    const release = client.acquireConsumer();
    const nextEnv = { ...options.env, LOBEHUB_OPERATION_ID: 'operation-2' };

    try {
      /** @example Credentials belong to the process compatibility boundary. */
      expect(
        client.canReuseFor({ ...options, env: { ...nextEnv, LOBEHUB_JWT: 'test-credential-b' } }),
      ).toBe(false);
      /** @example A missing process setting is incompatible even when the operation ID changes. */
      expect(client.canReuseFor({ ...options, env: { ...nextEnv, CODEX_HOME: undefined } })).toBe(
        false,
      );
      /** @example Only the exact operation ID key is ignored, not keys with the same prefix. */
      expect(
        client.canReuseFor({
          ...options,
          env: { ...nextEnv, LOBEHUB_OPERATION_ID_EXTRA: 'new-process-setting' },
        }),
      ).toBe(false);
      /** @example Rejecting an incompatible request leaves the first operation's consumer intact. */
      expect(client.hasConsumers).toBe(true);
    } finally {
      release();
      client.close();
    }
  });

  it('only reuses a process for the same binary, global arguments, and environment', () => {
    const client = new CodexAppServerClient({
      args: ['--config', 'model_provider="openai"'],
      clientVersion: '1.0.0',
      commandPath: '/usr/local/bin/codex',
      cwd: '/first-workspace',
      env: { ...process.env, CODEX_HOME: '/tmp/codex', IGNORED: undefined },
    });
    const launchOptions = {
      args: ['--config', 'model_provider="openai"'],
      commandPath: '/usr/local/bin/codex',
      cwd: '/second-workspace',
      env: { ...process.env, CODEX_HOME: '/tmp/codex' },
    };

    expect(client.canReuseFor(launchOptions)).toBe(true);
    expect(client.canReuseFor({ ...launchOptions, commandPath: '/opt/codex' })).toBe(false);
    expect(client.canReuseFor({ ...launchOptions, args: [] })).toBe(false);
    expect(
      client.canReuseFor({
        ...launchOptions,
        env: { ...process.env, CODEX_HOME: '/other' },
      }),
    ).toBe(false);
  });

  it('does not reuse a relative custom command across working directories', () => {
    const client = new CodexAppServerClient({
      clientVersion: '1.0.0',
      commandPath: './bin/codex',
      cwd: '/first-workspace',
      env: process.env,
    });
    const launchOptions = {
      commandPath: './bin/codex',
      cwd: '/first-workspace',
      env: process.env,
    };

    expect(client.canReuseFor(launchOptions)).toBe(true);
    expect(client.canReuseFor({ ...launchOptions, cwd: '/second-workspace' })).toBe(false);
  });

  it('tracks client consumers independently from attached thread registrations', () => {
    const client = createClient();
    const release = client.acquireConsumer();

    expect(client.hasConsumers).toBe(true);
    release();
    release();

    expect(client.hasConsumers).toBe(false);
    client.close();
  });

  it('does not spawn a process after close wins a delayed spawn-plan race', async () => {
    let resolveSpawnPlan!: (plan: { args: string[]; command: string }) => void;
    resolveCliSpawnPlanMock.mockReturnValue(
      new Promise((resolve) => {
        resolveSpawnPlan = resolve;
      }),
    );
    const client = createClient();
    const connecting = client.connect();

    client.close();
    resolveSpawnPlan({ args: ['app-server'], command: 'codex' });

    await expect(connecting).rejects.toThrow('closed by host');
    expect(spawnMock).not.toHaveBeenCalled();
  });

  it('frames NDJSON once and routes responses, notifications, and server requests', async () => {
    const { child, messages } = createProcess();
    spawnMock.mockReturnValue(child);
    vi.spyOn(process, 'kill').mockImplementation(() => true);
    const client = createClient();
    const notifications: string[] = [];
    const serverRequests: string[] = [];
    client.subscribe('thread-1', (method) => {
      notifications.push(method);
    });
    client.subscribeServerRequests('thread-1', (method) => {
      serverRequests.push(method);
      return { decision: 'cancel' };
    });

    await client.connect();
    const response = await client.request<{ thread: { id: string } }>('thread/start', {});
    await vi.waitFor(() =>
      expect(messages).toContainEqual({ id: 'approval-1', result: { decision: 'cancel' } }),
    );

    expect(response.thread.id).toBe('thread-1');
    expect(messages.map(({ method }) => method).filter(Boolean)).toEqual([
      'initialize',
      'initialized',
      'thread/start',
    ]);
    expect(notifications).toEqual(['turn/started']);
    expect(serverRequests).toEqual(['item/commandExecution/requestApproval']);
    expect(spawnMock).toHaveBeenCalledWith(
      'codex',
      ['app-server'],
      expect.objectContaining({ stdio: ['pipe', 'pipe', 'pipe'] }),
    );

    client.close();
  });

  it('routes raw messages only to the matching thread trace', async () => {
    const process = createProcess();
    spawnMock.mockReturnValue(process.child);
    vi.spyOn(globalThis.process, 'kill').mockImplementation(() => true);
    const client = createClient();
    const firstThreadLines: string[] = [];
    const secondThreadLines: string[] = [];
    client.onRawMessage('thread-1', (line) => {
      firstThreadLines.push(line);
    });
    client.onRawMessage('thread-2', (line) => {
      secondThreadLines.push(line);
    });
    await client.connect();

    process.send({ method: 'item/started', params: { item: {}, threadId: 'thread-1' } });
    process.send({ method: 'item/started', params: { item: {}, threadId: 'thread-2' } });
    await vi.waitFor(() => {
      expect(firstThreadLines).toHaveLength(1);
      expect(secondThreadLines).toHaveLength(1);
    });
    await client.request('thread/resume', { threadId: 'thread-1' });

    expect(firstThreadLines[0]).toContain('"threadId":"thread-1"');
    expect(firstThreadLines[0]).not.toContain('"threadId":"thread-2"');
    expect(firstThreadLines[1]).toContain('"result"');
    expect(secondThreadLines[0]).toContain('"threadId":"thread-2"');
    expect(secondThreadLines[0]).not.toContain('"threadId":"thread-1"');
    expect(secondThreadLines).toHaveLength(1);
    client.close();
  });

  it.each([-32_601, -32_602])(
    'classifies initialize RPC error %s as a compatibility fallback error',
    async (rejectInitializeCode) => {
      const { child } = createProcess({ rejectInitializeCode });
      spawnMock.mockReturnValue(child);
      const client = createClient();

      const error = await client.connect().catch((cause) => cause);

      expect(error).toBeInstanceOf(CodexAppServerRpcError);
      expect(error).toMatchObject({ method: 'initialize' });
      expect(isCodexAppServerCompatibilityError(error)).toBe(true);
    },
  );

  it('does not classify an ordinary thread RPC failure as a compatibility error', () => {
    const error = new CodexAppServerRpcError('Invalid model', -32_602, undefined, 'thread/start');

    expect(isCodexAppServerCompatibilityError(error)).toBe(false);
  });

  it('only classifies connection failures from the initial handshake as compatible', () => {
    expect(
      isCodexAppServerCompatibilityError(
        new CodexAppServerConnectionError('transport disconnected'),
      ),
    ).toBe(false);
    expect(
      isCodexAppServerCompatibilityError(
        new CodexAppServerConnectionError('initialize failed', { phase: 'initialize' }),
      ),
    ).toBe(true);
  });

  it('restarts with exponential backoff and resumes every registered thread', async () => {
    vi.useFakeTimers();
    const first = createProcess();
    const failedReconnect = createProcess({ rejectInitializeCode: -32_601 });
    const recovered = createProcess();
    spawnMock
      .mockReturnValueOnce(first.child)
      .mockReturnValueOnce(failedReconnect.child)
      .mockReturnValueOnce(recovered.child);
    vi.spyOn(process, 'kill').mockImplementation(() => true);
    const client = createClient({ reconnectBaseDelayMs: 10 });
    let resumedCount = 0;
    let resolveResumed!: () => void;
    const resumed = new Promise<void>((resolve) => {
      resolveResumed = resolve;
    });
    const onResume = () => {
      resumedCount += 1;
      if (resumedCount === 2) resolveResumed();
    };

    await client.connect();
    client.registerThread(
      'thread-1',
      { approvalPolicy: 'never', sandbox: 'danger-full-access', threadId: 'thread-1' },
      {
        onResume,
        onResumeError: vi.fn(),
      },
    );
    client.registerThread(
      'thread-2',
      { cwd: '/workspace/two', threadId: 'thread-2' },
      {
        onResume,
        onResumeError: vi.fn(),
      },
    );
    first.child.emit('exit', 1, null);

    await vi.advanceTimersByTimeAsync(10);
    expect(spawnMock).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(19);
    expect(spawnMock).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1);
    await resumed;

    expect(spawnMock).toHaveBeenCalledTimes(3);
    expect(
      recovered.messages
        .filter(({ method }) => method === 'thread/resume')
        .map(({ params }) => params),
    ).toEqual([
      { approvalPolicy: 'never', sandbox: 'danger-full-access', threadId: 'thread-1' },
      { cwd: '/workspace/two', threadId: 'thread-2' },
    ]);
    client.close();
  });

  it('ignores late stdout from an exited process after the replacement starts', async () => {
    vi.useFakeTimers();
    const first = createProcess();
    const recovered = createProcess();
    spawnMock.mockReturnValueOnce(first.child).mockReturnValueOnce(recovered.child);
    vi.spyOn(process, 'kill').mockImplementation(() => true);
    const client = createClient({ reconnectBaseDelayMs: 10 });
    let resolveResumed!: () => void;
    const resumed = new Promise<void>((resolve) => {
      resolveResumed = resolve;
    });

    await client.connect();
    client.registerThread(
      'thread-1',
      { approvalPolicy: 'never', threadId: 'thread-1' },
      { onResume: resolveResumed, onResumeError: vi.fn() },
    );
    first.child.emit('exit', 1, null);
    first.stdout.write('{"stale":');

    await vi.advanceTimersByTimeAsync(10);
    await resumed;

    expect(client.isConnected).toBe(true);
    expect(spawnMock).toHaveBeenCalledTimes(2);
    client.close();
  });

  it('keeps backing off when the replacement process dies while resuming threads', async () => {
    vi.useFakeTimers();
    const first = createProcess();
    const failedReconnect = createProcess({ exitOnResume: true });
    const recovered = createProcess();
    spawnMock
      .mockReturnValueOnce(first.child)
      .mockReturnValueOnce(failedReconnect.child)
      .mockReturnValueOnce(recovered.child);
    vi.spyOn(process, 'kill').mockImplementation(() => true);
    const client = createClient({ reconnectBaseDelayMs: 10 });
    let resolveResumed!: () => void;
    const resumed = new Promise<void>((resolve) => {
      resolveResumed = resolve;
    });
    const onResume = vi.fn(resolveResumed);
    const onResumeError = vi.fn();

    await client.connect();
    client.registerThread('thread-1', { threadId: 'thread-1' }, { onResume, onResumeError });
    first.child.emit('exit', 1, null);

    await vi.advanceTimersByTimeAsync(10);
    expect(spawnMock).toHaveBeenCalledTimes(2);
    expect(onResumeError).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(19);
    expect(spawnMock).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1);
    await resumed;

    expect(spawnMock).toHaveBeenCalledTimes(3);
    expect(onResume).toHaveBeenCalledOnce();
    client.close();
  });

  it('does not publish a stale resume after its process exits', async () => {
    vi.useFakeTimers();
    const first = createProcess();
    const staleReconnect = createProcess({ exitAfterResume: true });
    const recovered = createProcess();
    spawnMock
      .mockReturnValueOnce(first.child)
      .mockReturnValueOnce(staleReconnect.child)
      .mockReturnValueOnce(recovered.child);
    vi.spyOn(process, 'kill').mockImplementation(() => true);
    const client = createClient({ reconnectBaseDelayMs: 10 });
    let resolveResumed!: () => void;
    const resumed = new Promise<void>((resolve) => {
      resolveResumed = resolve;
    });
    const onResume = vi.fn(resolveResumed);

    await client.connect();
    client.registerThread(
      'thread-1',
      { threadId: 'thread-1' },
      { onResume, onResumeError: vi.fn() },
    );
    first.child.emit('exit', 1, null);

    await vi.advanceTimersByTimeAsync(10);
    expect(onResume).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(20);
    await resumed;

    expect(onResume).toHaveBeenCalledOnce();
    expect(client.isConnected).toBe(true);
    client.close();
  });

  it('stops automatic reconnect at the attempt budget and retries on explicit demand', async () => {
    vi.useFakeTimers();
    const first = createProcess();
    const failedOne = createProcess({ rejectInitializeCode: -32_601 });
    const failedTwo = createProcess({ rejectInitializeCode: -32_601 });
    const recovered = createProcess();
    spawnMock
      .mockReturnValueOnce(first.child)
      .mockReturnValueOnce(failedOne.child)
      .mockReturnValueOnce(failedTwo.child)
      .mockReturnValueOnce(recovered.child);
    vi.spyOn(process, 'kill').mockImplementation(() => true);
    const client = createClient({ reconnectBaseDelayMs: 10, reconnectMaxAttempts: 2 });
    const onResume = vi.fn();
    const onResumeError = vi.fn();

    await client.connect();
    client.registerThread('thread-1', { threadId: 'thread-1' }, { onResume, onResumeError });
    first.child.emit('exit', 1, null);

    await vi.advanceTimersByTimeAsync(10);
    await vi.advanceTimersByTimeAsync(20);
    await Promise.resolve();

    expect(spawnMock).toHaveBeenCalledTimes(3);
    expect(onResumeError).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(spawnMock).toHaveBeenCalledTimes(3);

    await client.connect();

    expect(spawnMock).toHaveBeenCalledTimes(4);
    expect(onResume).toHaveBeenCalledOnce();
    expect(client.isConnected).toBe(true);
    client.close();
  });

  it('drops a server-request response when its process disconnects while the handler waits', async () => {
    const process = createProcess();
    spawnMock.mockReturnValue(process.child);
    vi.spyOn(globalThis.process, 'kill').mockImplementation(() => true);
    const client = createClient();
    let resolveApproval!: () => void;
    const approval = new Promise<void>((resolve) => {
      resolveApproval = resolve;
    });
    const handler = vi.fn(async () => {
      await approval;
      return { decision: 'accept' };
    });
    client.subscribeServerRequests('thread-1', handler);
    await client.connect();
    const writesBeforeRequest = process.messages.length;

    process.send({
      id: 'approval-late',
      method: 'item/commandExecution/requestApproval',
      params: { threadId: 'thread-1' },
    });
    await vi.waitFor(() => expect(handler).toHaveBeenCalledOnce());
    process.child.emit('exit', 1, null);
    resolveApproval();
    await approval;
    await Promise.resolve();

    expect(process.messages).toHaveLength(writesBeforeRequest);
    client.close();
  });

  it('clears a pending request when stdin.write throws synchronously', async () => {
    vi.useFakeTimers();
    const process = createProcess({ throwOnMethod: 'thread/start' });
    spawnMock.mockReturnValue(process.child);
    vi.spyOn(globalThis.process, 'kill').mockImplementation(() => true);
    const client = createClient();
    const onDisconnect = vi.fn();
    client.onDisconnect(onDisconnect);
    await client.connect();

    await expect(client.request('thread/start', {})).rejects.toMatchObject({
      cause: expect.objectContaining({ message: 'stdin write failed' }),
      message: 'Failed to write Codex app-server request: thread/start',
    });
    expect(onDisconnect).toHaveBeenCalledOnce();

    await vi.advanceTimersByTimeAsync(30_000);
    expect(onDisconnect).toHaveBeenCalledOnce();
    client.close();
  });
});

import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  CodexAppServerClient,
  CodexAppServerConnectionError,
  CodexAppServerRpcError,
  isCodexAppServerCompatibilityError,
} from './CodexAppServerClient';

const { spawnMock } = vi.hoisted(() => ({ spawnMock: vi.fn() }));

vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, spawn: spawnMock };
});

interface RpcMessage {
  id?: number | string;
  method?: string;
  params?: Record<string, unknown>;
  result?: unknown;
}

const createProcess = (options: { exitOnResume?: boolean; rejectInitializeCode?: number } = {}) => {
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
        }
      });
      return true;
    }),
  };

  return { child, messages };
};

const createClient = (options: { reconnectBaseDelayMs?: number } = {}) =>
  new CodexAppServerClient({
    clientVersion: '1.0.0',
    commandPath: 'codex',
    cwd: '/workspace',
    env: process.env,
    ...options,
  });

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  spawnMock.mockReset();
});

describe('CodexAppServerClient', () => {
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
    await vi.waitFor(() => expect(serverRequests).toHaveLength(1));

    expect(response.thread.id).toBe('thread-1');
    expect(messages.map(({ method }) => method).filter(Boolean)).toEqual([
      'initialize',
      'initialized',
      'thread/start',
    ]);
    expect(notifications).toEqual(['turn/started']);
    expect(serverRequests).toEqual(['item/commandExecution/requestApproval']);
    expect(messages).toContainEqual({ id: 'approval-1', result: { decision: 'cancel' } });
    expect(spawnMock).toHaveBeenCalledWith(
      'codex',
      ['app-server'],
      expect.objectContaining({ stdio: ['pipe', 'pipe', 'pipe'] }),
    );

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
    client.registerThread('thread-1', {
      onResume,
      onResumeError: vi.fn(),
    });
    client.registerThread('thread-2', {
      onResume,
      onResumeError: vi.fn(),
    });
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
    ).toEqual([{ threadId: 'thread-1' }, { threadId: 'thread-2' }]);
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
    client.registerThread('thread-1', { onResume, onResumeError });
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
});

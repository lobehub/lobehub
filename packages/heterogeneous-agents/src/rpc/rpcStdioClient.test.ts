import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { RpcStdioClient, RpcStdioConnectionError } from './rpcStdioClient';

const { spawnMock } = vi.hoisted(() => ({ spawnMock: vi.fn() }));
const originalPlatform = process.platform;

vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, spawn: spawnMock };
});

const createProcess = () => {
  const child = new EventEmitter() as any;
  const stdout = new PassThrough();
  const writes: Array<Record<string, unknown>> = [];
  child.pid = 123_456;
  child.killed = false;
  child.exitCode = null;
  child.signalCode = null;
  child.kill = vi.fn(() => true);
  child.stdout = stdout;
  child.stderr = new PassThrough();
  child.stdin = {
    once: vi.fn(),
    end: vi.fn(() => {
      setTimeout(() => child.emit('close', 0, null), 1);
    }),
    write: vi.fn((chunk: string) => {
      writes.push(JSON.parse(chunk.trim()));
      return true;
    }),
  };
  return { child, stdout, writes };
};

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
  spawnMock.mockReset();
  Object.defineProperty(process, 'platform', { value: originalPlatform });
});

/**
 * The transport is protocol-agnostic: the default `isResponse` matches
 * JSON-RPC-2.0-shaped responses (has `id`, no `method`), so an ACP-style
 * protocol can ride it unchanged. pi supplies its own `isResponse`.
 */
describe('RpcStdioClient (generic transport)', () => {
  it('decodes UTF-8 across byte boundaries without treating Unicode separators as framing', async () => {
    const { child, stdout } = createProcess();
    spawnMock.mockReturnValue(child);
    const onMessage = vi.fn();
    const onStderr = vi.fn();
    const client = new RpcStdioClient({
      args: [],
      commandPath: 'agent',
      cwd: '/workspace',
      env: { ...process.env },
      onMessage,
      onStderr,
    });
    await client.start();
    const message = { text: '中文🙂\u2028next\u2029line' };
    for (const byte of Buffer.from(`${JSON.stringify(message)}\r\n`))
      stdout.write(Buffer.from([byte]));
    for (const byte of Buffer.from('错误🙂')) child.stderr.write(Buffer.from([byte]));
    child.stderr.end();
    await vi.waitFor(() => expect(onMessage).toHaveBeenCalledWith(message));
    expect(onMessage).toHaveBeenCalledTimes(1);
    expect(onStderr.mock.calls.map(([text]) => text).join('')).toBe('错误🙂');
    expect(client.stderrText).toBe('错误🙂');
    await client.close();
  });

  it('reports a fatal exit once even without pending requests and becomes unusable', async () => {
    const { child } = createProcess();
    spawnMock.mockReturnValue(child);
    const onError = vi.fn();
    const client = new RpcStdioClient({
      args: [],
      commandPath: 'agent',
      cwd: '/workspace',
      env: { ...process.env },
      onError,
      onMessage: vi.fn(),
      onStderr: vi.fn(),
    });
    await client.start();
    child.stderr.write('process crashed');
    child.emit('close', 1, null);
    await vi.waitFor(() => expect(onError).toHaveBeenCalledTimes(1));
    expect(onError.mock.calls[0][0].message).toContain('exited unexpectedly');
    expect(client.isClosed).toBe(true);
    child.emit('error', new Error('late error'));
    expect(onError).toHaveBeenCalledTimes(1);
    await client.close();
    expect(child.stdin.end).not.toHaveBeenCalled();
  });

  it('shares close completion and waits for SIGKILL and the actual close event', async () => {
    vi.useFakeTimers();
    const { child } = createProcess();
    child.stdin.end.mockImplementation(() => {});
    spawnMock.mockReturnValue(child);
    // Exercise the direct-child fallback: killed means signalled, not exited.
    vi.spyOn(process, 'kill').mockImplementation(() => {
      throw new Error('no process group');
    });
    child.kill.mockImplementation(() => {
      child.killed = true;
      return true;
    });
    const client = new RpcStdioClient({
      args: [],
      commandPath: 'agent',
      cwd: '/workspace',
      env: { ...process.env },
      closeGraceMs: 50,
      onMessage: vi.fn(),
      onStderr: vi.fn(),
    });
    await client.start();
    const close = client.close();
    expect(client.close()).toBe(close);
    const finished = vi.fn();
    void close.then(finished);
    await vi.advanceTimersByTimeAsync(50);
    expect(child.kill).toHaveBeenCalledWith('SIGTERM');
    expect(finished).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(2000);
    expect(child.kill).toHaveBeenCalledWith('SIGKILL');
    expect(finished).not.toHaveBeenCalled();
    child.emit('close', null, 'SIGKILL');
    await close;
    expect(finished).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each(['error', 'nonzero'])(
    'falls back when Windows taskkill fails asynchronously (%s)',
    async (failure) => {
      vi.useFakeTimers();
      const { child } = createProcess();
      child.stdin.end.mockImplementation(() => {});
      spawnMock.mockReturnValue(child);
      const client = new RpcStdioClient({
        args: [],
        commandPath: 'agent',
        cwd: '/workspace',
        env: { ...process.env },
        closeGraceMs: 50,
        onMessage: vi.fn(),
        onStderr: vi.fn(),
      });
      await client.start();
      Object.defineProperty(process, 'platform', { value: 'win32' });
      const killer = new EventEmitter();
      spawnMock.mockReturnValue(killer);
      child.kill.mockImplementation(() => {
        child.emit('close', null, 'SIGTERM');
        return true;
      });
      const closed = client.close();
      await vi.advanceTimersByTimeAsync(50);
      if (failure === 'error') killer.emit('error', new Error('taskkill unavailable'));
      else killer.emit('exit', 1);
      await closed;
      expect(child.kill).toHaveBeenCalledWith('SIGTERM');
      expect(vi.getTimerCount()).toBe(0);
    },
  );

  it('rejects bounded shutdown if no close follows SIGKILL', async () => {
    vi.useFakeTimers();
    const { child } = createProcess();
    child.stdin.end.mockImplementation(() => {});
    spawnMock.mockReturnValue(child);
    vi.spyOn(process, 'kill').mockReturnValue(true);
    const client = new RpcStdioClient({
      args: [],
      commandPath: 'agent',
      cwd: '/workspace',
      env: { ...process.env },
      closeGraceMs: 50,
      onMessage: vi.fn(),
      onStderr: vi.fn(),
    });
    await client.start();
    const result = expect(client.close()).rejects.toThrow('did not exit after SIGKILL');
    await vi.advanceTimersByTimeAsync(4050);
    await result;
    expect(vi.getTimerCount()).toBe(0);
  });

  it('correlates JSON-RPC-2.0-shaped responses by id and routes notifications to onMessage', async () => {
    const { child, stdout, writes } = createProcess();
    spawnMock.mockReturnValue(child);
    const messages: unknown[] = [];
    const client = new RpcStdioClient({
      args: ['agent', 'stdio'],
      commandPath: 'agent',
      cwd: '/workspace',
      env: { ...process.env },
      onMessage: (message) => void messages.push(message),
      onStderr: vi.fn(),
    });
    await client.start();

    // A notification (no id) must go to onMessage, never resolve a request.
    stdout.write(`${JSON.stringify({ method: 'initialized' })}\n`);

    const first = client.request<{ result: { value: string } }>({ method: 'first' });
    const second = client.request<{ result: { value: string } }>({ method: 'second' });
    const firstId = writes.at(-2)!.id;
    const secondId = writes.at(-1)!.id;

    stdout.write(`${JSON.stringify({ id: secondId, jsonrpc: '2.0', result: { value: 'two' } })}\n`);
    const firstLine = `${JSON.stringify({
      id: firstId,
      jsonrpc: '2.0',
      result: { value: 'one' },
    })}\n`;
    // Split one line across chunks to prove LF-only framing (no readline).
    stdout.write(firstLine.slice(0, 9));
    stdout.write(firstLine.slice(9));

    // The transport delivers the RAW response message — interpreting `result`
    // vs `error` is the protocol layer's job.
    await expect(Promise.all([first, second])).resolves.toEqual([
      expect.objectContaining({ jsonrpc: '2.0', result: { value: 'one' } }),
      expect.objectContaining({ jsonrpc: '2.0', result: { value: 'two' } }),
    ]);
    expect(messages).toEqual([{ method: 'initialized' }]);
    await client.close();
    expect(child.stdin.end).toHaveBeenCalled();
  });

  it('rejects pending requests when the child dies, with stderr attached', async () => {
    const { child, stdout, writes } = createProcess();
    spawnMock.mockReturnValue(child);
    const client = new RpcStdioClient({
      args: ['agent', 'stdio'],
      commandPath: 'agent',
      cwd: '/workspace',
      env: { ...process.env },
      onMessage: vi.fn(),
      onStderr: vi.fn(),
    });
    await client.start();

    const request = client.request({ method: 'authenticate' });
    // `first` never gets its response — the process dies instead.
    expect(writes).toHaveLength(1); // request id already written
    stdout.end();
    child.emit('close', 1, null);

    await expect(request).rejects.toThrow(RpcStdioConnectionError);
    await expect(request).rejects.toThrow(/exited unexpectedly/);
    await client.close();
  });

  it('rejects pending requests on host close so callers never hang', async () => {
    const { child, client } = (() => {
      const { child } = createProcess();
      spawnMock.mockReturnValue(child);
      const messages: unknown[] = [];
      const c = new RpcStdioClient({
        args: ['agent', 'stdio'],
        commandPath: 'agent',
        cwd: '/workspace',
        env: { ...process.env },
        onMessage: (message) => void messages.push(message),
        onStderr: vi.fn(),
      });
      return { child, client: c };
    })();
    await client.start();

    const pending = client.request({ method: 'never-answered' });
    const closed = client.close();
    await expect(pending).rejects.toThrow(/closed by host/);
    await closed;
    expect(child.stdin.end).toHaveBeenCalled();
  });

  it('notify() writes fire-and-forget messages', async () => {
    const { child, writes } = createProcess();
    spawnMock.mockReturnValue(child);
    const client = new RpcStdioClient({
      args: ['agent', 'stdio'],
      commandPath: 'agent',
      cwd: '/workspace',
      env: { ...process.env },
      onMessage: vi.fn(),
      onStderr: vi.fn(),
    });
    await client.start();

    client.notify({ method: 'initialized' });
    expect(writes.at(-1)).toEqual({ method: 'initialized' });
    await client.close();
  });
});

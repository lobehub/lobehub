import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { RpcStdioClient, RpcStdioConnectionError } from './rpcStdioClient';

const { spawnMock } = vi.hoisted(() => ({ spawnMock: vi.fn() }));

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
  spawnMock.mockReset();
});

/**
 * The transport is protocol-agnostic: the default `isResponse` matches
 * JSON-RPC-2.0-shaped responses (has `id`, no `method`), so an ACP-style
 * protocol can ride it unchanged. pi supplies its own `isResponse`.
 */
describe('RpcStdioClient (generic transport)', () => {
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

    stdout.write(
      `${JSON.stringify({ id: secondId, jsonrpc: '2.0', result: { value: 'two' } })}\n`,
    );
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
    writes[0]; // (id already written)
    stdout.end();
    child.emit('close', 1, null);

    await expect(request).rejects.toThrow(RpcStdioConnectionError);
    await expect(request).rejects.toThrow(/exited unexpectedly/);
    await client.close();
  });

  it('rejects pending requests on host close so callers never hang', async () => {
    const { child, client } = (() => {
      const { child, stdout, writes } = createProcess();
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
      return { child, client: c, stdout, writes };
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

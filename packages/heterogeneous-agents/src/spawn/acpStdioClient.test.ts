import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { AcpStdioClient } from './acpStdioClient';

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
  child.kill = vi.fn(() => true);
  child.stdout = stdout;
  child.stderr = new PassThrough();
  child.stdin = {
    once: vi.fn(),
    write: vi.fn((chunk: string) => {
      writes.push(JSON.parse(chunk.trim()));
      return true;
    }),
  };
  return { child, stdout, writes };
};

afterEach(() => {
  Object.defineProperty(process, 'platform', { configurable: true, value: originalPlatform });
  vi.restoreAllMocks();
  spawnMock.mockReset();
});

describe('AcpStdioClient', () => {
  it('frames split NDJSON and correlates concurrent responses by request id', async () => {
    const { child, stdout, writes } = createProcess();
    spawnMock.mockReturnValue(child);
    vi.spyOn(process, 'kill').mockImplementation(() => true);
    const messages: unknown[] = [];
    const client = new AcpStdioClient({
      args: ['agent', 'stdio'],
      commandPath: 'agent',
      cwd: '/workspace',
      env: { ...process.env },
      onMessage: (message) => {
        messages.push(message);
      },
      onRawMessage: vi.fn(),
      onStderr: vi.fn(),
    });
    await client.start();

    const first = client.request<{ value: string }>('first');
    const second = client.request<{ value: string }>('second');
    const firstId = writes[0].id;
    const secondId = writes[1].id;
    stdout.write(`${JSON.stringify({ id: secondId, jsonrpc: '2.0', result: { value: 'two' } })}\n`);
    const firstLine = `${JSON.stringify({
      id: firstId,
      jsonrpc: '2.0',
      result: { value: 'one' },
    })}\n`;
    stdout.write(firstLine.slice(0, 12));
    stdout.write(firstLine.slice(12));

    await expect(Promise.all([first, second])).resolves.toEqual([
      { value: 'one' },
      { value: 'two' },
    ]);
    expect(messages).toHaveLength(2);
    client.close();
  });

  it('drains a final structured RPC error before applying the process-exit fallback', async () => {
    const { child, stdout, writes } = createProcess();
    spawnMock.mockReturnValue(child);
    vi.spyOn(process, 'kill').mockImplementation(() => true);
    const onMessage = vi.fn();
    const client = new AcpStdioClient({
      args: ['agent', 'stdio'],
      commandPath: 'agent',
      cwd: '/workspace',
      env: { ...process.env },
      onMessage,
      onRawMessage: vi.fn(),
      onStderr: vi.fn(),
    });
    await client.start();

    const request = client.request('authenticate');
    stdout.write(
      `${JSON.stringify({
        error: { code: -32_000, message: 'Authentication required' },
        id: writes[0].id,
        jsonrpc: '2.0',
      })}\n`,
    );
    stdout.end();
    child.emit('close', 1, null);

    await expect(request).rejects.toThrow(
      'ACP request failed (authenticate): Authentication required',
    );
    expect(onMessage).toHaveBeenCalledWith(
      expect.objectContaining({ requestMethod: 'authenticate' }),
    );
    client.close();
  });

  it('does not dispatch queued or subsequent stdout messages after host close', async () => {
    const { child, stdout } = createProcess();
    spawnMock.mockReturnValue(child);
    vi.spyOn(process, 'kill').mockImplementation(() => true);
    let releaseFirstMessage: (() => void) | undefined;
    const onMessage = vi.fn().mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          releaseFirstMessage = resolve;
        }),
    );
    const client = new AcpStdioClient({
      args: ['agent', 'stdio'],
      commandPath: 'agent',
      cwd: '/workspace',
      env: { ...process.env },
      onMessage,
      onRawMessage: vi.fn(),
      onStderr: vi.fn(),
    });
    await client.start();

    stdout.write(`${JSON.stringify({ method: 'first' })}\n`);
    stdout.write(`${JSON.stringify({ method: 'queued' })}\n`);
    await vi.waitFor(() => expect(releaseFirstMessage).toBeTypeOf('function'));

    client.close();
    stdout.write(`${JSON.stringify({ method: 'after-close' })}\n`);
    releaseFirstMessage!();
    await client.drain();

    expect(onMessage).toHaveBeenCalledOnce();
    expect(onMessage).toHaveBeenCalledWith({ method: 'first' });
  });

  it('terminates the child process tree with taskkill on Windows', async () => {
    Object.defineProperty(process, 'platform', { configurable: true, value: 'win32' });
    const { child } = createProcess();
    spawnMock.mockReturnValue(child);
    const client = new AcpStdioClient({
      args: ['agent', 'stdio'],
      commandPath: 'agent',
      cwd: 'C:\\workspace',
      env: { ...process.env },
      onMessage: vi.fn(),
      onRawMessage: vi.fn(),
      onStderr: vi.fn(),
    });
    await client.start();

    client.close('SIGKILL');

    expect(spawnMock).toHaveBeenNthCalledWith(2, 'taskkill', ['/pid', '123456', '/T', '/F'], {
      stdio: 'ignore',
    });
    expect(child.kill).not.toHaveBeenCalled();
  });
});

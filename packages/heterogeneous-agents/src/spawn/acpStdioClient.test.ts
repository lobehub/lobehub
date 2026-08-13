import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { AcpStdioClient } from './acpStdioClient';

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
    const client = new AcpStdioClient({
      args: ['agent', 'stdio'],
      commandPath: 'agent',
      cwd: '/workspace',
      env: { ...process.env },
      onMessage: vi.fn(),
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
    client.close();
  });
});

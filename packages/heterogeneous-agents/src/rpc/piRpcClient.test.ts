import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { PiRpcClient, PiRpcConnectionError, PiRpcResponseError } from './piRpcClient';
import type { PiRpcEvent } from './piRpcProtocol';

const { spawnMock } = vi.hoisted(() => ({ spawnMock: vi.fn() }));

vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, spawn: spawnMock };
});

const originalPlatform = process.platform;

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
      // Simulate pi exiting cleanly on EOF.
      setTimeout(() => child.emit('close', 0, null), 1);
    }),
    write: vi.fn((chunk: string) => {
      writes.push(JSON.parse(chunk.trim()));
      return true;
    }),
  };
  return { child, stdout, writes };
};

/** Fixture: an RPC process that answers the startup `get_state` handshake. */
const createReadyClient = async (
  options: Partial<ConstructorParameters<typeof PiRpcClient>[0]> = {},
) => {
  const { child, stdout, writes } = createProcess();
  spawnMock.mockReturnValue(child);
  const events: unknown[] = [];
  const client = new PiRpcClient({
    args: [],
    commandPath: 'pi',
    cwd: '/workspace',
    env: { ...process.env },
    onEvent: (event: PiRpcEvent) => void events.push(event),
    onStderr: vi.fn(),
    ...options,
  } as any);
  const started = client.start();
  // Answer the handshake as soon as get_state is written.
  await vi.waitFor(() => {
    const getState = writes.find((w) => w.type === 'get_state');
    expect(getState).toBeTruthy();
  });
  const getState = writes.find((w) => w.type === 'get_state')!;
  stdout.write(
    `${JSON.stringify({ command: 'get_state', data: { sessionId: 'sess-1' }, id: getState.id, success: true, type: 'response' })}\n`,
  );
  await started;
  return { child, client, events, stdout, writes };
};

afterEach(() => {
  vi.restoreAllMocks();
  spawnMock.mockReset();
  Object.defineProperty(process, 'platform', { configurable: true, value: originalPlatform });
});

describe('PiRpcClient', () => {
  it('spawns `pi --mode rpc` with LF-only framing and correlates responses', async () => {
    const { child, client, stdout, writes } = await createReadyClient();

    const first = client.command<{ value: string }>({ type: 'get_commands' });
    const second = client.command<{ value: string }>({ type: 'get_available_models' });
    const firstId = writes.at(-2)!.id;
    const secondId = writes.at(-1)!.id;

    // Split one line across chunks to prove LF-only framing (no readline).
    const secondLine = `${JSON.stringify({
      command: 'get_available_models',
      data: { value: 'two' },
      id: secondId,
      success: true,
      type: 'response',
    })}\n`;
    stdout.write(secondLine.slice(0, 10));
    stdout.write(secondLine.slice(10));
    stdout.write(
      `${JSON.stringify({
        command: 'get_commands',
        data: { value: 'one' },
        id: firstId,
        success: true,
        type: 'response',
      })}\n`,
    );

    await expect(Promise.all([first, second])).resolves.toEqual([
      expect.objectContaining({ data: { value: 'one' }, success: true }),
      expect.objectContaining({ data: { value: 'two' }, success: true }),
    ]);
    // The spawned target must be pi: the bare `pi` binary on Unix, or a
    // resolved node shim (node.exe + script path) on Windows — assert on the
    // command + first argv together so both platforms hold.
    const [spawnCommand, spawnArgs] = spawnMock.mock.calls[0] as [string, string[]];
    expect(`${spawnCommand} ${spawnArgs[0] ?? ''}`.toLowerCase()).toContain('pi');
    expect(spawnArgs).toEqual(expect.arrayContaining(['--mode', 'rpc']));
    await client.close();
    expect(child.stdin.end).toHaveBeenCalled();
  });

  it('exposes the native session id from the get_state handshake (RPC has no session event)', async () => {
    const { client } = await createReadyClient();
    expect(client.sessionId).toBe('sess-1');
    await client.close();
  });

  it('rejects on `success: false` responses with the command name', async () => {
    const { client, stdout, writes } = await createReadyClient();
    const request = client.command({ type: 'set_model', provider: 'x', modelId: 'y' });
    stdout.write(
      `${JSON.stringify({
        command: 'set_model',
        error: 'Model not found: x/y',
        id: writes.at(-1)!.id,
        success: false,
        type: 'response',
      })}\n`,
    );
    await expect(request).rejects.toThrow(PiRpcResponseError);
    await expect(request).rejects.toThrow(/set_model.*Model not found/);
    await client.close();
  });

  it('answers extension UI dialogs and cancels them without a handler', async () => {
    const { client, stdout, writes } = await createReadyClient({
      onExtensionUiRequest: (request) =>
        request.method === 'select'
          ? { cancelled: false, id: request.id, value: 'Allow', type: 'extension_ui_response' }
          : undefined,
    });
    stdout.write(
      `${JSON.stringify({ id: 'ext-1', method: 'select', options: ['Allow', 'Block'], title: 'Allow?', type: 'extension_ui_request' })}\n`,
    );
    stdout.write(
      `${JSON.stringify({ id: 'ext-2', method: 'confirm', message: 'Sure?', title: 'Confirm', type: 'extension_ui_request' })}\n`,
    );
    await vi.waitFor(() => {
      expect(writes.some((w) => w.type === 'extension_ui_response' && w.id === 'ext-1')).toBe(true);
      expect(
        writes.some(
          (w) => w.type === 'extension_ui_response' && w.id === 'ext-2' && w.cancelled === true,
        ),
      ).toBe(true);
    });
    await client.close();
  });

  it('rejects commands when the process dies before responding', async () => {
    const { child, client, stdout } = await createReadyClient();
    const request = client.command({ type: 'get_messages' });
    stdout.end();
    child.emit('close', 1, null);
    await expect(request).rejects.toThrow(PiRpcConnectionError);
    await expect(request).rejects.toThrow(/exited unexpectedly/);
    await client.close();
  });

  it('hard-fails the handshake when get_state never answers', async () => {
    const { child } = createProcess();
    spawnMock.mockReturnValue(child);
    const client = new PiRpcClient({
      args: [],
      commandPath: 'pi',
      cwd: '/workspace',
      env: { ...process.env },
      handshakeTimeoutMs: 100,
      onEvent: vi.fn(),
      onStderr: vi.fn(),
    });
    const started = client.start();
    await expect(started).rejects.toThrow(PiRpcConnectionError);
    await expect(started).rejects.toThrow(/handshake/);
  });

  it('gracefully closes via stdin EOF and escalates only when exit stalls', async () => {
    Object.defineProperty(process, 'platform', { configurable: true, value: 'darwin' });
    vi.spyOn(process, 'kill').mockImplementation(() => true);
    const { child, client } = await createReadyClient({ closeGraceMs: 50 });
    // Override the simulated clean-exit so the process lingers.
    child.stdin.end = vi.fn(() => {
      /* no exit */
    });
    await client.close();
    // SIGTERM escalation attempted after the grace window.
    expect(process.kill).toHaveBeenCalledWith(-child.pid, 'SIGTERM');
  });
});

import { afterEach, describe, expect, it, vi } from 'vitest';

import { createPiRpcAgentHandle } from './piRpcAgentHandle';
import { toPiRpcPrompt } from './piRpcAgentHandle';
import type { PiRpcEvent } from './piRpcProtocol';

const mocks = vi.hoisted(() => ({
  clientInstances: [] as any[],
  command: vi.fn(),
  start: vi.fn(),
  close: vi.fn(),
  abort: vi.fn(),
}));

vi.mock('./piRpcClient', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./piRpcClient')>();
  return {
    ...actual,
    PiRpcClient: class MockPiRpcClient {
      static instances = mocks.clientInstances;
      onEvent?: (event: PiRpcEvent) => void | Promise<void>;
      constructor(readonly options: any) {
        this.onEvent = options.onEvent;
        mocks.clientInstances.push(this);
      }
      get pid() {
        return 123_456;
      }
      get sessionId() {
        return undefined;
      }
      start = mocks.start;
      command = mocks.command;
      close = mocks.close;
      abort = mocks.abort;
    },
  };
});

const emit = (event: PiRpcEvent) => {
  const client = mocks.clientInstances.at(-1)!;
  return client.onEvent!(event);
};

afterEach(() => {
  vi.restoreAllMocks();
  mocks.clientInstances.length = 0;
  mocks.start.mockReset();
  mocks.command.mockReset();
  mocks.close.mockReset();
  mocks.abort.mockReset();
});

describe('toPiRpcPrompt', () => {
  it('joins text blocks and leaves image-less prompts image-free', async () => {
    await expect(toPiRpcPrompt('hello')).resolves.toEqual({ text: 'hello' });
    await expect(
      toPiRpcPrompt([{ text: 'one', type: 'text' }, { text: 'two', type: 'text' }]),
    ).resolves.toEqual({ text: 'one\n\ntwo' });
  });
});

describe('createPiRpcAgentHandle', () => {
  it('streams adapted events, resolves exit on settle, and reports the native session id', async () => {
    mocks.start.mockResolvedValue(undefined);
    mocks.command.mockImplementation((command: { type: string }) => {
      if (command.type === 'get_state') {
        return Promise.resolve({ success: true, type: 'response', command: 'get_state' });
      }
      return Promise.resolve({ success: true, type: 'response', command: command.type });
    });
    mocks.close.mockResolvedValue(undefined);

    const handle = await createPiRpcAgentHandle({
      args: [],
      commandPath: 'pi',
      cwd: '/workspace',
      env: { ...process.env },
      operationId: 'op-cli',
      prompt: { text: 'inspect the repo' },
    });

    const collected: string[] = [];
    const consume = (async () => {
      for await (const event of handle.events) {
        if (event.type === 'stream_chunk' && event.data.chunkType === 'text') {
          collected.push(event.data.content);
        }
      }
    })();

    await emit({ type: 'session', id: 'native-1' });
    await emit({
      assistantMessageEvent: { contentIndex: 0, delta: 'Hi', type: 'text_delta' },
      type: 'message_update',
    });
    await emit({ type: 'agent_settled' });

    await consume;
    await expect(handle.exit).resolves.toEqual({ code: 0, signal: null });
    expect(collected.join('')).toBe('Hi');
    expect(handle.sessionId).toBe('native-1');
  });

  it('rejects on spawn/handshake failure so the CLI can classify it', async () => {
    mocks.start.mockRejectedValue(new Error('pi did not answer the RPC handshake'));
    await expect(
      createPiRpcAgentHandle({
        args: [],
        commandPath: 'pi',
        cwd: '/workspace',
        env: { ...process.env },
        operationId: 'op-cli',
        prompt: { text: 'x' },
      }),
    ).rejects.toThrow(/handshake/);
  });

  it('maps kill(SIGINT) to a graceful abort', async () => {
    mocks.start.mockResolvedValue(undefined);
    mocks.command.mockImplementation((command: { type: string }) => {
      if (command.type === 'get_state') {
        return Promise.resolve({ success: true, type: 'response', command: 'get_state' });
      }
      return Promise.resolve({ success: true, type: 'response', command: command.type });
    });
    mocks.close.mockResolvedValue(undefined);

    const handle = await createPiRpcAgentHandle({
      args: [],
      commandPath: 'pi',
      cwd: '/workspace',
      env: { ...process.env },
      operationId: 'op-cli',
      prompt: { text: 'x' },
    });

    handle.kill('SIGINT');
    expect(mocks.abort).toHaveBeenCalled();
  });
});

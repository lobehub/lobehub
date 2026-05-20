import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Command } from 'commander';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { registerBotMessageCommands } from './botMessage';

const { mockTrpcClient } = vi.hoisted(() => ({
  mockTrpcClient: {
    botMessage: {
      sendMessage: { mutate: vi.fn() },
    },
  },
}));

const { getTrpcClient: mockGetTrpcClient } = vi.hoisted(() => ({
  getTrpcClient: vi.fn(),
}));

vi.mock('../api/client', () => ({ getTrpcClient: mockGetTrpcClient }));
vi.mock('../utils/logger', () => ({
  log: { debug: vi.fn(), error: vi.fn(), info: vi.fn(), warn: vi.fn() },
  setVerbose: vi.fn(),
}));

describe('bot message send --attachment', () => {
  let exitSpy: ReturnType<typeof vi.spyOn>;
  let consoleSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {}) as any);
    consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    mockGetTrpcClient.mockResolvedValue(mockTrpcClient);
    mockTrpcClient.botMessage.sendMessage.mutate.mockReset();
    mockTrpcClient.botMessage.sendMessage.mutate.mockResolvedValue({ messageId: 'm-1' });
  });

  afterEach(() => {
    exitSpy.mockRestore();
    consoleSpy.mockRestore();
  });

  function createProgram() {
    const program = new Command();
    program.exitOverride();
    const bot = program.command('bot');
    registerBotMessageCommands(bot);
    return program;
  }

  it('passes a remote URL through as fetchUrl', async () => {
    const program = createProgram();
    await program.parseAsync([
      'node',
      'test',
      'bot',
      'message',
      'send',
      'bot-1',
      '--target',
      'ch-1',
      '--message',
      'hi',
      '--attachment',
      'https://cdn.example.com/foo.png',
    ]);

    expect(mockTrpcClient.botMessage.sendMessage.mutate).toHaveBeenCalledWith(
      expect.objectContaining({
        attachments: [
          expect.objectContaining({
            fetchUrl: 'https://cdn.example.com/foo.png',
            mimeType: 'image/png',
            name: 'foo.png',
            type: 'image',
          }),
        ],
        botId: 'bot-1',
        channelId: 'ch-1',
        content: 'hi',
      }),
    );
  });

  it('base64-encodes a local file path', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'lh-cli-attach-'));
    const path = join(dir, 'tiny.txt');
    await writeFile(path, 'hello');

    const program = createProgram();
    await program.parseAsync([
      'node',
      'test',
      'bot',
      'message',
      'send',
      'bot-1',
      '--target',
      'ch-1',
      '--message',
      'm',
      '--attachment',
      path,
    ]);

    const call = mockTrpcClient.botMessage.sendMessage.mutate.mock.calls[0][0];
    expect(call.attachments).toHaveLength(1);
    expect(call.attachments[0]).toMatchObject({
      mimeType: 'text/plain',
      name: 'tiny.txt',
      type: 'file',
    });
    expect(call.attachments[0].data).toBe(Buffer.from('hello').toString('base64'));
    expect(call.attachments[0].fetchUrl).toBeUndefined();
  });

  it('accepts multiple --attachment flags', async () => {
    const program = createProgram();
    await program.parseAsync([
      'node',
      'test',
      'bot',
      'message',
      'send',
      'bot-1',
      '--target',
      'ch-1',
      '--message',
      'm',
      '--attachment',
      'https://cdn.example.com/a.png',
      '--attachment',
      'https://cdn.example.com/b.pdf',
    ]);

    const call = mockTrpcClient.botMessage.sendMessage.mutate.mock.calls[0][0];
    expect(call.attachments).toHaveLength(2);
    expect(call.attachments[0]).toMatchObject({ type: 'image', name: 'a.png' });
    expect(call.attachments[1]).toMatchObject({ type: 'file', name: 'b.pdf' });
  });

  it('omits attachments field when no flag is given', async () => {
    const program = createProgram();
    await program.parseAsync([
      'node',
      'test',
      'bot',
      'message',
      'send',
      'bot-1',
      '--target',
      'ch-1',
      '--message',
      'm',
    ]);

    const call = mockTrpcClient.botMessage.sendMessage.mutate.mock.calls[0][0];
    expect(call.attachments).toBeUndefined();
  });
});

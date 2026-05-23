import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { Command } from 'commander';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { registerBotMessageCommands } from './botMessage';

const { mockTrpcClient } = vi.hoisted(() => ({
  mockTrpcClient: {
    botMessage: {
      replyToThread: { mutate: vi.fn() },
      sendDirectMessage: { mutate: vi.fn() },
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
    mockTrpcClient.botMessage.sendDirectMessage.mutate.mockReset();
    mockTrpcClient.botMessage.sendDirectMessage.mutate.mockResolvedValue({
      channelId: 'dm-1',
      messageId: 'm-dm-1',
    });
    mockTrpcClient.botMessage.replyToThread.mutate.mockReset();
    mockTrpcClient.botMessage.replyToThread.mutate.mockResolvedValue({ messageId: 'm-tr-1' });
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
    const dir = await mkdtemp(path.join(tmpdir(), 'lh-cli-attach-'));
    const filePath = path.join(dir, 'tiny.txt');
    await writeFile(filePath, 'hello');

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
      filePath,
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

describe('bot message dm --attachment', () => {
  let exitSpy: ReturnType<typeof vi.spyOn>;
  let consoleSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {}) as any);
    consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    mockGetTrpcClient.mockResolvedValue(mockTrpcClient);
    mockTrpcClient.botMessage.sendDirectMessage.mutate.mockReset();
    mockTrpcClient.botMessage.sendDirectMessage.mutate.mockResolvedValue({
      channelId: 'dm-1',
      messageId: 'm-dm-1',
    });
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

  it('sends a DM with a remote-URL attachment', async () => {
    const program = createProgram();
    await program.parseAsync([
      'node',
      'test',
      'bot',
      'message',
      'dm',
      'bot-1',
      '--user-id',
      'u-1',
      '--message',
      'hi',
      '--attachment',
      'https://cdn.example.com/foo.png',
    ]);

    expect(mockTrpcClient.botMessage.sendDirectMessage.mutate).toHaveBeenCalledWith(
      expect.objectContaining({
        attachments: [
          expect.objectContaining({
            fetchUrl: 'https://cdn.example.com/foo.png',
            type: 'image',
          }),
        ],
        botId: 'bot-1',
        content: 'hi',
        userId: 'u-1',
      }),
    );
  });

  it('omits attachments when no flag is given', async () => {
    const program = createProgram();
    await program.parseAsync([
      'node',
      'test',
      'bot',
      'message',
      'dm',
      'bot-1',
      '--user-id',
      'u-1',
      '--message',
      'plain',
    ]);
    const call = mockTrpcClient.botMessage.sendDirectMessage.mutate.mock.calls[0][0];
    expect(call.attachments).toBeUndefined();
  });
});

describe('bot message thread reply --attachment', () => {
  let exitSpy: ReturnType<typeof vi.spyOn>;
  let consoleSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {}) as any);
    consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    mockGetTrpcClient.mockResolvedValue(mockTrpcClient);
    mockTrpcClient.botMessage.replyToThread.mutate.mockReset();
    mockTrpcClient.botMessage.replyToThread.mutate.mockResolvedValue({ messageId: 'm-tr-1' });
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

  it('replies to a thread with attachments', async () => {
    const program = createProgram();
    await program.parseAsync([
      'node',
      'test',
      'bot',
      'message',
      'thread',
      'reply',
      'bot-1',
      '--thread-id',
      'th-1',
      '--message',
      'reply',
      '--attachment',
      'https://cdn.example.com/a.png',
    ]);

    expect(mockTrpcClient.botMessage.replyToThread.mutate).toHaveBeenCalledWith(
      expect.objectContaining({
        attachments: [
          expect.objectContaining({
            fetchUrl: 'https://cdn.example.com/a.png',
            type: 'image',
          }),
        ],
        botId: 'bot-1',
        content: 'reply',
        threadId: 'th-1',
      }),
    );
  });
});

describe('bot message send via System Bot messenger install (@id)', () => {
  let exitSpy: ReturnType<typeof vi.spyOn>;
  let consoleSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {}) as any);
    consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    mockGetTrpcClient.mockResolvedValue(mockTrpcClient);
    mockTrpcClient.botMessage.sendMessage.mutate.mockReset();
    mockTrpcClient.botMessage.sendMessage.mutate.mockResolvedValue({ messageId: 'm-mi-1' });
    mockTrpcClient.botMessage.sendDirectMessage.mutate.mockReset();
    mockTrpcClient.botMessage.sendDirectMessage.mutate.mockResolvedValue({ messageId: 'm-mi-2' });
    mockTrpcClient.botMessage.replyToThread.mutate.mockReset();
    mockTrpcClient.botMessage.replyToThread.mutate.mockResolvedValue({ messageId: 'm-mi-3' });
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

  it('@-prefixed positional arg routes to messengerInstallationId on send', async () => {
    const program = createProgram();
    await program.parseAsync([
      'node',
      'test',
      'bot',
      'message',
      'send',
      '@inst_abc',
      '--target',
      'C1',
      '--message',
      'hi',
    ]);

    const call = mockTrpcClient.botMessage.sendMessage.mutate.mock.calls[0][0];
    expect(call.messengerInstallationId).toBe('inst_abc');
    expect(call.botId).toBeUndefined();
    expect(call.channelId).toBe('C1');
  });

  it('@-prefixed routes on dm', async () => {
    const program = createProgram();
    await program.parseAsync([
      'node',
      'test',
      'bot',
      'message',
      'dm',
      '@inst_xyz',
      '--user-id',
      'U1',
      '--message',
      'hi',
    ]);
    const call = mockTrpcClient.botMessage.sendDirectMessage.mutate.mock.calls[0][0];
    expect(call.messengerInstallationId).toBe('inst_xyz');
    expect(call.botId).toBeUndefined();
  });

  it('@-prefixed routes on thread reply', async () => {
    const program = createProgram();
    await program.parseAsync([
      'node',
      'test',
      'bot',
      'message',
      'thread',
      'reply',
      '@inst_thr',
      '--thread-id',
      'T1',
      '--message',
      'r',
    ]);
    const call = mockTrpcClient.botMessage.replyToThread.mutate.mock.calls[0][0];
    expect(call.messengerInstallationId).toBe('inst_thr');
  });

  it('plain (non-@) positional stays as botId', async () => {
    const program = createProgram();
    await program.parseAsync([
      'node',
      'test',
      'bot',
      'message',
      'send',
      'uuid-bot-id',
      '--target',
      'C1',
      '--message',
      'hi',
    ]);
    const call = mockTrpcClient.botMessage.sendMessage.mutate.mock.calls[0][0];
    expect(call.botId).toBe('uuid-bot-id');
    expect(call.messengerInstallationId).toBeUndefined();
  });
});

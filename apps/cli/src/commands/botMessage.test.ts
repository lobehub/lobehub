import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import type {
  SendMessageDelivery,
  SendMessageState,
} from '@lobechat/builtin-tool-message/delivery';
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

describe('bot message send delivery outcomes', () => {
  let originalExitCode: typeof process.exitCode;
  let consoleSpy: ReturnType<typeof vi.spyOn>;
  let exitSpy: ReturnType<typeof vi.spyOn>;
  let exitCodesAtOutput: Array<typeof process.exitCode>;

  beforeEach(() => {
    originalExitCode = process.exitCode;
    process.exitCode = 0;
    exitCodesAtOutput = [];
    consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {
      exitCodesAtOutput.push(process.exitCode);
    });
    exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('Output must finish before setting the exit status');
    });
    mockGetTrpcClient.mockResolvedValue(mockTrpcClient);
    mockTrpcClient.botMessage.sendMessage.mutate.mockReset();
  });

  afterEach(() => {
    process.exitCode = originalExitCode;
    consoleSpy.mockRestore();
    exitSpy.mockRestore();
  });

  const deliveries: SendMessageDelivery[] = [
    {
      attachments: [{ index: 0, status: 'accepted', type: 'image' }],
      receipt: 'unconfirmed',
      status: 'accepted',
      text: { status: 'accepted' },
    },
    {
      attachments: [{ index: 0, reason: 'over_budget', status: 'link_fallback', type: 'image' }],
      receipt: 'unconfirmed',
      status: 'degraded',
      text: { status: 'accepted' },
    },
    {
      attachments: [{ index: 0, reason: 'upload_failed', status: 'failed', type: 'image' }],
      receipt: 'unconfirmed',
      status: 'partial',
      text: { status: 'accepted' },
    },
    {
      attachments: [{ index: 0, reason: 'upload_failed', status: 'failed', type: 'image' }],
      receipt: 'unconfirmed',
      status: 'failed',
      text: { status: 'not_requested' },
    },
    {
      attachments: [{ index: 0, reason: 'send_unconfirmed', status: 'unknown', type: 'image' }],
      receipt: 'unconfirmed',
      status: 'unknown',
      text: { status: 'accepted' },
    },
  ];

  const runSend = async (json: boolean, message = 'fixture text') => {
    const program = new Command();
    program.exitOverride();
    registerBotMessageCommands(program.command('bot'));
    await program.parseAsync([
      'node',
      'test',
      'bot',
      'message',
      'send',
      'fixture-bot',
      '--target',
      'fixture',
      '--message',
      message,
      '--attachment',
      'https://example.com/fixture.png',
      ...(json ? ['--json'] : []),
    ]);
    return consoleSpy.mock.calls.map(([text]) => String(text)).join('\n');
  };

  it.each(
    deliveries.flatMap((delivery) => [
      { delivery, json: false },
      { delivery, json: true },
    ]),
  )(
    'reports $delivery.status with json=$json before setting the exit code',
    async ({ delivery, json }) => {
      const state: SendMessageState = { channelId: 'fixture', delivery, platform: 'wechat' };
      mockTrpcClient.botMessage.sendMessage.mutate.mockResolvedValueOnce(state);

      const output = await runSend(json, delivery.status === 'failed' ? '' : 'fixture text');

      expect(process.exitCode).toBe(delivery.status === 'accepted' ? 0 : 1);
      expect(exitSpy).not.toHaveBeenCalled();
      expect(exitCodesAtOutput).toEqual([0]);
      expect(mockTrpcClient.botMessage.sendMessage.mutate).toHaveBeenCalledTimes(1);
      if (json) {
        expect(JSON.parse(output)).toEqual(state);
      } else {
        expect(output).toContain(JSON.stringify(delivery, null, 2));
        expect(output).not.toContain('with 1 attachment(s)');
        if (delivery.status !== 'accepted') {
          expect(output).toContain('Do not resend the entire request');
          expect(output).not.toContain('Message sent');
        }
      }
    },
  );

  it.each([false, true])(
    'reports an old WeChat response as unconfirmed with json=%s',
    async (json) => {
      const state = { channelId: 'fixture', platform: 'wechat' };
      mockTrpcClient.botMessage.sendMessage.mutate.mockResolvedValueOnce(state);

      const output = await runSend(json);

      expect(process.exitCode).toBe(1);
      if (json) expect(JSON.parse(output)).toEqual(state);
      else expect(output).toContain('did not provide per-item send results');
    },
  );

  it.each([false, true])('preserves legacy non-WeChat results with json=%s', async (json) => {
    const state = { channelId: 'fixture', messageId: 'actual-id', platform: 'discord' };
    mockTrpcClient.botMessage.sendMessage.mutate.mockResolvedValueOnce(state);

    const output = await runSend(json);

    expect(process.exitCode).toBe(0);
    if (json) expect(JSON.parse(output)).toEqual(state);
    else {
      expect(output).toContain('Message sent');
      expect(output).toContain('actual-id');
      expect(output).toContain('with 1 attachment(s)');
    }
  });
});

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
      mimeType: 'text/plain; charset=utf-8',
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

import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { Command } from 'commander';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { registerBotMessageCommands } from './botMessage';

const { mockTrpcClient } = vi.hoisted(() => ({
  mockTrpcClient: {
    botMessage: {
      listOutboundChannels: { query: vi.fn() },
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

describe('bot channels list', () => {
  let exitSpy: ReturnType<typeof vi.spyOn>;
  let consoleSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {}) as any);
    consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    mockGetTrpcClient.mockResolvedValue(mockTrpcClient);
    mockTrpcClient.botMessage.listOutboundChannels.query.mockReset();
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

  it('renders the ranked outbound channels table', async () => {
    mockTrpcClient.botMessage.listOutboundChannels.query.mockResolvedValueOnce([
      {
        agentId: 'agent_1',
        applicationId: 'A1',
        botId: 'bot_abc',
        platform: 'discord',
        recommended: true,
        source: 'agent_bot',
      },
      {
        applicationId: 'A2',
        messengerInstallationId: 'inst_xyz',
        platform: 'discord',
        recommended: false,
        source: 'system_messenger',
        tenantId: 'T1',
        tenantName: 'Acme Corp',
      },
      {
        applicationId: 'A3',
        messengerInstallationId: 'inst_slk',
        platform: 'slack',
        recommended: true,
        source: 'system_messenger',
        tenantId: 'T2',
        tenantName: 'Other WS',
      },
    ]);

    const program = createProgram();
    await program.parseAsync(['node', 'test', 'bot', 'channels', 'list']);
    expect(mockTrpcClient.botMessage.listOutboundChannels.query).toHaveBeenCalled();

    // Sanity check the rendered table includes the SEND ARG values verbatim
    // so users can copy-paste them — per-agent stays raw, system bot gets the
    // `@` prefix that `resolveSendTargetArg` parses back.
    const rendered = consoleSpy.mock.calls.map((c) => String(c[0])).join('\n');
    expect(rendered).toContain('bot_abc');
    expect(rendered).toContain('@inst_xyz');
    expect(rendered).toContain('@inst_slk');
  });

  it('reports empty state with installation guidance', async () => {
    mockTrpcClient.botMessage.listOutboundChannels.query.mockResolvedValueOnce([]);
    const program = createProgram();
    await program.parseAsync(['node', 'test', 'bot', 'channels', 'list']);
    const rendered = consoleSpy.mock.calls.map((c) => String(c[0])).join('\n');
    expect(rendered).toContain('No outbound channels');
    expect(rendered).toMatch(/Settings → Messenger|per-agent bot/);
  });

  it('--json emits the raw payload', async () => {
    const payload = [
      {
        applicationId: 'A1',
        botId: 'bot_only',
        platform: 'telegram',
        recommended: true,
        source: 'agent_bot',
      },
    ];
    mockTrpcClient.botMessage.listOutboundChannels.query.mockResolvedValueOnce(payload);
    const program = createProgram();
    await program.parseAsync(['node', 'test', 'bot', 'channels', 'list', '--json']);
    const rendered = consoleSpy.mock.calls.map((c) => String(c[0])).join('\n');
    expect(rendered).toContain('"botId": "bot_only"');
  });

  it('--platform filters case-insensitively', async () => {
    mockTrpcClient.botMessage.listOutboundChannels.query.mockResolvedValueOnce([
      { botId: 'bot_d', platform: 'discord', recommended: true, source: 'agent_bot' },
      {
        messengerInstallationId: 'inst_s',
        platform: 'slack',
        recommended: true,
        source: 'system_messenger',
        tenantName: 'Acme',
      },
    ]);

    const program = createProgram();
    await program.parseAsync([
      'node',
      'test',
      'bot',
      'channels',
      'list',
      '--platform',
      'DISCORD',
      '--json',
    ]);
    const rendered = consoleSpy.mock.calls.map((c) => String(c[0])).join('\n');
    expect(rendered).toContain('"botId": "bot_d"');
    expect(rendered).not.toContain('inst_s');
  });

  it('--platform with no matches surfaces platform-specific guidance', async () => {
    mockTrpcClient.botMessage.listOutboundChannels.query.mockResolvedValueOnce([
      { botId: 'bot_d', platform: 'discord', recommended: true, source: 'agent_bot' },
    ]);

    const program = createProgram();
    await program.parseAsync(['node', 'test', 'bot', 'channels', 'list', '--platform', 'slack']);
    const rendered = consoleSpy.mock.calls.map((c) => String(c[0])).join('\n');
    expect(rendered).toContain("for platform 'slack'");
    expect(rendered).toContain('Settings → Messenger');
  });
});

import { Command } from 'commander';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { log } from '../utils/logger';
import { registerBotCommand } from './bot';

const { mockTrpcClient } = vi.hoisted(() => ({
  mockTrpcClient: {
    agentBotProvider: {
      connectBot: { mutate: vi.fn() },
      create: { mutate: vi.fn() },
      delete: { mutate: vi.fn() },
      getByAgentId: { query: vi.fn() },
      list: { query: vi.fn() },
      update: { mutate: vi.fn() },
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

describe('bot command', () => {
  let exitSpy: ReturnType<typeof vi.spyOn>;
  let consoleSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {}) as any);
    consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    mockGetTrpcClient.mockResolvedValue(mockTrpcClient);
    for (const method of Object.values(mockTrpcClient.agentBotProvider)) {
      for (const fn of Object.values(method)) {
        (fn as ReturnType<typeof vi.fn>).mockReset();
      }
    }
  });

  afterEach(() => {
    exitSpy.mockRestore();
    consoleSpy.mockRestore();
  });

  function createProgram() {
    const program = new Command();
    program.exitOverride();
    registerBotCommand(program);
    return program;
  }

  describe('list', () => {
    it('should list all bot integrations', async () => {
      mockTrpcClient.agentBotProvider.list.query.mockResolvedValue([
        {
          agentId: 'agent1',
          applicationId: 'app123',
          enabled: true,
          id: 'b1',
          platform: 'discord',
        },
      ]);

      const program = createProgram();
      await program.parseAsync(['node', 'test', 'bot', 'list']);

      expect(mockTrpcClient.agentBotProvider.list.query).toHaveBeenCalledWith({});
      expect(consoleSpy).toHaveBeenCalledTimes(2); // header + 1 row
      expect(consoleSpy.mock.calls[0][0]).toContain('ID');
    });

    it('should filter by agent', async () => {
      mockTrpcClient.agentBotProvider.list.query.mockResolvedValue([]);

      const program = createProgram();
      await program.parseAsync(['node', 'test', 'bot', 'list', '--agent', 'agent1']);

      expect(mockTrpcClient.agentBotProvider.list.query).toHaveBeenCalledWith({
        agentId: 'agent1',
      });
    });

    it('should filter by platform', async () => {
      mockTrpcClient.agentBotProvider.list.query.mockResolvedValue([]);

      const program = createProgram();
      await program.parseAsync(['node', 'test', 'bot', 'list', '--platform', 'discord']);

      expect(mockTrpcClient.agentBotProvider.list.query).toHaveBeenCalledWith({
        platform: 'discord',
      });
    });

    it('should output JSON', async () => {
      const items = [{ id: 'b1', platform: 'discord' }];
      mockTrpcClient.agentBotProvider.list.query.mockResolvedValue(items);

      const program = createProgram();
      await program.parseAsync(['node', 'test', 'bot', 'list', '--json']);

      expect(consoleSpy).toHaveBeenCalledWith(JSON.stringify(items, null, 2));
    });

    it('should show message when no bots found', async () => {
      mockTrpcClient.agentBotProvider.list.query.mockResolvedValue([]);

      const program = createProgram();
      await program.parseAsync(['node', 'test', 'bot', 'list']);

      expect(consoleSpy).toHaveBeenCalledWith('No bot integrations found.');
    });
  });

  describe('view', () => {
    it('should display bot details', async () => {
      mockTrpcClient.agentBotProvider.getByAgentId.query.mockResolvedValue([
        {
          applicationId: 'app123',
          credentials: { botToken: 'tok_12345678' },
          enabled: true,
          id: 'b1',
          platform: 'discord',
        },
      ]);

      const program = createProgram();
      await program.parseAsync(['node', 'test', 'bot', 'view', 'b1', '--agent', 'agent1']);

      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('discord'));
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('app123'));
    });

    it('should error when bot not found', async () => {
      mockTrpcClient.agentBotProvider.getByAgentId.query.mockResolvedValue([]);

      const program = createProgram();
      await program.parseAsync(['node', 'test', 'bot', 'view', 'nonexistent', '--agent', 'agent1']);

      expect(log.error).toHaveBeenCalledWith(expect.stringContaining('not found'));
      expect(exitSpy).toHaveBeenCalledWith(1);
    });
  });

  describe('add', () => {
    it('should add a discord bot', async () => {
      mockTrpcClient.agentBotProvider.create.mutate.mockResolvedValue({ id: 'new-bot' });

      const program = createProgram();
      await program.parseAsync([
        'node',
        'test',
        'bot',
        'add',
        '--agent',
        'agent1',
        '--platform',
        'discord',
        '--app-id',
        'app123',
        '--bot-token',
        'tok123',
        '--public-key',
        'pk123',
      ]);

      expect(mockTrpcClient.agentBotProvider.create.mutate).toHaveBeenCalledWith({
        agentId: 'agent1',
        applicationId: 'app123',
        credentials: { botToken: 'tok123', publicKey: 'pk123' },
        platform: 'discord',
      });
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Added'));
    });

    it('should add a telegram bot', async () => {
      mockTrpcClient.agentBotProvider.create.mutate.mockResolvedValue({ id: 'new-bot' });

      const program = createProgram();
      await program.parseAsync([
        'node',
        'test',
        'bot',
        'add',
        '--agent',
        'agent1',
        '--platform',
        'telegram',
        '--app-id',
        'tg123',
        '--bot-token',
        'tok123',
      ]);

      expect(mockTrpcClient.agentBotProvider.create.mutate).toHaveBeenCalledWith({
        agentId: 'agent1',
        applicationId: 'tg123',
        credentials: { botToken: 'tok123' },
        platform: 'telegram',
      });
    });

    it('should reject invalid platform', async () => {
      const program = createProgram();
      await program.parseAsync([
        'node',
        'test',
        'bot',
        'add',
        '--agent',
        'agent1',
        '--platform',
        'invalid',
        '--app-id',
        'x',
        '--bot-token',
        'x',
      ]);

      expect(log.error).toHaveBeenCalledWith(expect.stringContaining('Invalid platform'));
      expect(exitSpy).toHaveBeenCalledWith(1);
    });

    it('should reject missing required credentials', async () => {
      const program = createProgram();
      await program.parseAsync([
        'node',
        'test',
        'bot',
        'add',
        '--agent',
        'agent1',
        '--platform',
        'discord',
        '--app-id',
        'app123',
        '--bot-token',
        'tok123',
        // missing --public-key
      ]);

      expect(log.error).toHaveBeenCalledWith(expect.stringContaining('Missing required'));
      expect(exitSpy).toHaveBeenCalledWith(1);
    });
  });

  describe('update', () => {
    it('should update bot credentials', async () => {
      mockTrpcClient.agentBotProvider.update.mutate.mockResolvedValue({});

      const program = createProgram();
      await program.parseAsync(['node', 'test', 'bot', 'update', 'b1', '--bot-token', 'new-token']);

      expect(mockTrpcClient.agentBotProvider.update.mutate).toHaveBeenCalledWith(
        expect.objectContaining({
          credentials: { botToken: 'new-token' },
          id: 'b1',
        }),
      );
    });

    it('should error when no changes specified', async () => {
      const program = createProgram();
      await program.parseAsync(['node', 'test', 'bot', 'update', 'b1']);

      expect(log.error).toHaveBeenCalledWith(expect.stringContaining('No changes'));
      expect(exitSpy).toHaveBeenCalledWith(1);
    });
  });

  describe('remove', () => {
    it('should remove with --yes', async () => {
      mockTrpcClient.agentBotProvider.delete.mutate.mockResolvedValue({});

      const program = createProgram();
      await program.parseAsync(['node', 'test', 'bot', 'remove', 'b1', '--yes']);

      expect(mockTrpcClient.agentBotProvider.delete.mutate).toHaveBeenCalledWith({ id: 'b1' });
    });
  });

  describe('enable / disable', () => {
    it('should enable a bot', async () => {
      mockTrpcClient.agentBotProvider.update.mutate.mockResolvedValue({});

      const program = createProgram();
      await program.parseAsync(['node', 'test', 'bot', 'enable', 'b1']);

      expect(mockTrpcClient.agentBotProvider.update.mutate).toHaveBeenCalledWith(
        expect.objectContaining({ enabled: true, id: 'b1' }),
      );
    });

    it('should disable a bot', async () => {
      mockTrpcClient.agentBotProvider.update.mutate.mockResolvedValue({});

      const program = createProgram();
      await program.parseAsync(['node', 'test', 'bot', 'disable', 'b1']);

      expect(mockTrpcClient.agentBotProvider.update.mutate).toHaveBeenCalledWith(
        expect.objectContaining({ enabled: false, id: 'b1' }),
      );
    });
  });

  describe('connect', () => {
    it('should connect a bot', async () => {
      mockTrpcClient.agentBotProvider.getByAgentId.query.mockResolvedValue([
        { applicationId: 'app123', id: 'b1', platform: 'discord' },
      ]);
      mockTrpcClient.agentBotProvider.connectBot.mutate.mockResolvedValue({ status: 'connected' });

      const program = createProgram();
      await program.parseAsync(['node', 'test', 'bot', 'connect', 'b1', '--agent', 'agent1']);

      expect(mockTrpcClient.agentBotProvider.connectBot.mutate).toHaveBeenCalledWith({
        applicationId: 'app123',
        platform: 'discord',
      });
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Connected'));
    });

    it('should error when bot not found', async () => {
      mockTrpcClient.agentBotProvider.getByAgentId.query.mockResolvedValue([]);

      const program = createProgram();
      await program.parseAsync([
        'node',
        'test',
        'bot',
        'connect',
        'nonexistent',
        '--agent',
        'agent1',
      ]);

      expect(log.error).toHaveBeenCalledWith(expect.stringContaining('not found'));
      expect(exitSpy).toHaveBeenCalledWith(1);
    });
  });
});

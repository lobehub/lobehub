import { Command } from 'commander';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { registerMessageCommand } from './message';

const { mockTrpcClient } = vi.hoisted(() => ({
  mockTrpcClient: {
    message: {
      count: { query: vi.fn() },
      getHeatmaps: { query: vi.fn() },
      getMessages: { query: vi.fn() },
      removeMessage: { mutate: vi.fn() },
      removeMessages: { mutate: vi.fn() },
      searchMessages: { query: vi.fn() },
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

describe('message command', () => {
  let exitSpy: ReturnType<typeof vi.spyOn>;
  let consoleSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {}) as any);
    consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    mockGetTrpcClient.mockResolvedValue(mockTrpcClient);
    for (const method of Object.values(mockTrpcClient.message)) {
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
    registerMessageCommand(program);
    return program;
  }

  describe('list', () => {
    it('should display messages', async () => {
      mockTrpcClient.message.getMessages.query.mockResolvedValue([
        { content: 'Hello', createdAt: new Date().toISOString(), id: 'm1', role: 'user' },
      ]);

      const program = createProgram();
      await program.parseAsync(['node', 'test', 'message', 'list']);

      expect(consoleSpy).toHaveBeenCalledTimes(2);
    });

    it('should filter by topic-id', async () => {
      mockTrpcClient.message.getMessages.query.mockResolvedValue([]);

      const program = createProgram();
      await program.parseAsync(['node', 'test', 'message', 'list', '--topic-id', 't1']);

      expect(mockTrpcClient.message.getMessages.query).toHaveBeenCalledWith(
        expect.objectContaining({ topicId: 't1' }),
      );
    });
  });

  describe('search', () => {
    it('should search messages', async () => {
      mockTrpcClient.message.searchMessages.query.mockResolvedValue([]);

      const program = createProgram();
      await program.parseAsync(['node', 'test', 'message', 'search', 'hello']);

      expect(mockTrpcClient.message.searchMessages.query).toHaveBeenCalledWith({
        keywords: 'hello',
      });
    });
  });

  describe('delete', () => {
    it('should delete single message', async () => {
      mockTrpcClient.message.removeMessage.mutate.mockResolvedValue({});

      const program = createProgram();
      await program.parseAsync(['node', 'test', 'message', 'delete', 'm1', '--yes']);

      expect(mockTrpcClient.message.removeMessage.mutate).toHaveBeenCalledWith({ id: 'm1' });
    });

    it('should batch delete messages', async () => {
      mockTrpcClient.message.removeMessages.mutate.mockResolvedValue({});

      const program = createProgram();
      await program.parseAsync(['node', 'test', 'message', 'delete', 'm1', 'm2', '--yes']);

      expect(mockTrpcClient.message.removeMessages.mutate).toHaveBeenCalledWith({
        ids: ['m1', 'm2'],
      });
    });
  });

  describe('count', () => {
    it('should count messages', async () => {
      mockTrpcClient.message.count.query.mockResolvedValue(42);

      const program = createProgram();
      await program.parseAsync(['node', 'test', 'message', 'count']);

      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('42'));
    });

    it('should output JSON', async () => {
      mockTrpcClient.message.count.query.mockResolvedValue(42);

      const program = createProgram();
      await program.parseAsync(['node', 'test', 'message', 'count', '--json']);

      expect(consoleSpy).toHaveBeenCalledWith(JSON.stringify({ count: 42 }));
    });
  });
});

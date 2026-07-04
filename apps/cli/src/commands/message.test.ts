import { Command } from 'commander';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { registerMessageCommand } from './message';

const { mockTrpcClient } = vi.hoisted(() => ({
  mockTrpcClient: {
    message: {
      count: { query: vi.fn() },
      countByTopic: { query: vi.fn() },
      getHeatmaps: { query: vi.fn() },
      getMessages: { query: vi.fn() },
      listAll: { query: vi.fn() },
      removeMessage: { mutate: vi.fn() },
      removeMessages: { mutate: vi.fn() },
      searchMessages: { query: vi.fn() },
      topicStats: { query: vi.fn() },
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
    it('should use listAll when no filters', async () => {
      mockTrpcClient.message.listAll.query.mockResolvedValue([
        { content: 'Hello', createdAt: new Date().toISOString(), id: 'm1', role: 'user' },
      ]);

      const program = createProgram();
      await program.parseAsync(['node', 'test', 'message', 'list']);

      expect(mockTrpcClient.message.listAll.query).toHaveBeenCalled();
      expect(mockTrpcClient.message.getMessages.query).not.toHaveBeenCalled();
      expect(consoleSpy).toHaveBeenCalledTimes(2);
    });

    it('should filter by topic-id using getMessages', async () => {
      mockTrpcClient.message.getMessages.query.mockResolvedValue([]);

      const program = createProgram();
      await program.parseAsync(['node', 'test', 'message', 'list', '--topic-id', 't1']);

      expect(mockTrpcClient.message.getMessages.query).toHaveBeenCalledWith(
        expect.objectContaining({ topicId: 't1' }),
      );
      expect(mockTrpcClient.message.listAll.query).not.toHaveBeenCalled();
    });

    it('should keep first page on the backend default offset for filtered queries', async () => {
      mockTrpcClient.message.getMessages.query.mockResolvedValue([]);

      const program = createProgram();
      await program.parseAsync([
        'node',
        'test',
        'message',
        'list',
        '--topic-id',
        't1',
        '-L',
        '200',
      ]);

      expect(mockTrpcClient.message.getMessages.query).toHaveBeenCalledWith(
        expect.objectContaining({ pageSize: 200, topicId: 't1' }),
      );
    });

    it('should convert page 2 to current 1 for filtered queries', async () => {
      mockTrpcClient.message.getMessages.query.mockResolvedValue([]);

      const program = createProgram();
      await program.parseAsync([
        'node',
        'test',
        'message',
        'list',
        '--topic-id',
        't1',
        '--page',
        '2',
      ]);

      expect(mockTrpcClient.message.getMessages.query).toHaveBeenCalledWith(
        expect.objectContaining({ current: 1, topicId: 't1' }),
      );
    });

    it('should support the short page flag for filtered queries', async () => {
      mockTrpcClient.message.getMessages.query.mockResolvedValue([]);

      const program = createProgram();
      await program.parseAsync(['node', 'test', 'message', 'list', '--topic-id', 't1', '-P', '2']);

      expect(mockTrpcClient.message.getMessages.query).toHaveBeenCalledWith(
        expect.objectContaining({ current: 1, topicId: 't1' }),
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

    it('should forward topic / agent / role filters', async () => {
      mockTrpcClient.message.count.query.mockResolvedValue(3);

      const program = createProgram();
      await program.parseAsync([
        'node',
        'test',
        'message',
        'count',
        '--topic-id',
        't1',
        '--agent-id',
        'a1',
        '--role',
        'user',
      ]);

      expect(mockTrpcClient.message.count.query).toHaveBeenCalledWith({
        agentId: 'a1',
        role: 'user',
        topicId: 't1',
      });
    });

    it('should group by topic', async () => {
      mockTrpcClient.message.countByTopic.query.mockResolvedValue([
        { count: 7, topicId: 't1' },
        { count: 2, topicId: 't2' },
      ]);

      const program = createProgram();
      await program.parseAsync([
        'node',
        'test',
        'message',
        'count',
        '--group-by',
        'topic',
        '--agent-id',
        'a1',
        '--json',
      ]);

      expect(mockTrpcClient.message.countByTopic.query).toHaveBeenCalledWith({ agentId: 'a1' });
      expect(mockTrpcClient.message.count.query).not.toHaveBeenCalled();
      expect(consoleSpy).toHaveBeenCalledWith(
        JSON.stringify([
          { count: 7, topicId: 't1' },
          { count: 2, topicId: 't2' },
        ]),
      );
    });

    it('should reject an unsupported --group-by', async () => {
      const program = createProgram();
      await program.parseAsync(['node', 'test', 'message', 'count', '--group-by', 'agent']);

      expect(exitSpy).toHaveBeenCalledWith(1);
      expect(mockTrpcClient.message.countByTopic.query).not.toHaveBeenCalled();
    });
  });

  describe('stats', () => {
    const sampleStats = {
      histogram: [
        { topics: 1, userCount: 1 },
        { topics: 1, userCount: 5 },
      ],
      max: 5,
      mean: 3,
      median: 3,
      min: 1,
      oneshot: 1,
      oneshotRatio: 0.5,
      p90: 5,
      p99: 5,
      topics: 2,
      totalMessages: 6,
    };

    it('should default to user-role distribution', async () => {
      mockTrpcClient.message.topicStats.query.mockResolvedValue(sampleStats);

      const program = createProgram();
      await program.parseAsync(['node', 'test', 'message', 'stats', '--agent-id', 'a1']);

      expect(mockTrpcClient.message.topicStats.query).toHaveBeenCalledWith({
        agentId: 'a1',
        role: 'user',
      });
    });

    it('should support --all-roles', async () => {
      mockTrpcClient.message.topicStats.query.mockResolvedValue(sampleStats);

      const program = createProgram();
      await program.parseAsync(['node', 'test', 'message', 'stats', '--all-roles']);

      expect(mockTrpcClient.message.topicStats.query).toHaveBeenCalledWith({});
    });

    it('should output JSON', async () => {
      mockTrpcClient.message.topicStats.query.mockResolvedValue(sampleStats);

      const program = createProgram();
      await program.parseAsync(['node', 'test', 'message', 'stats', '--json']);

      expect(consoleSpy).toHaveBeenCalledWith(JSON.stringify(sampleStats, null, 2));
    });
  });
});

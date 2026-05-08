import { Command } from 'commander';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { log } from '../utils/logger';
import { registerTopicCommand } from './topic';

const { mockTrpcClient } = vi.hoisted(() => ({
  mockTrpcClient: {
    topic: {
      batchDelete: { mutate: vi.fn() },
      createTopic: { mutate: vi.fn() },
      getTopics: { query: vi.fn() },
      recentTopics: { query: vi.fn() },
      removeTopic: { mutate: vi.fn() },
      searchTopics: { query: vi.fn() },
      updateTopic: { mutate: vi.fn() },
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

describe('topic command', () => {
  let exitSpy: ReturnType<typeof vi.spyOn>;
  let consoleSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {}) as any);
    consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    mockGetTrpcClient.mockResolvedValue(mockTrpcClient);
    for (const method of Object.values(mockTrpcClient.topic)) {
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
    registerTopicCommand(program);
    return program;
  }

  describe('list', () => {
    it('should display topics', async () => {
      mockTrpcClient.topic.getTopics.query.mockResolvedValue([
        { id: 't1', title: 'Topic 1', updatedAt: new Date().toISOString() },
      ]);

      const program = createProgram();
      await program.parseAsync(['node', 'test', 'topic', 'list']);

      expect(consoleSpy).toHaveBeenCalledTimes(2);
    });

    it('should filter by agent-id', async () => {
      mockTrpcClient.topic.getTopics.query.mockResolvedValue([]);

      const program = createProgram();
      await program.parseAsync(['node', 'test', 'topic', 'list', '--agent-id', 'a1']);

      expect(mockTrpcClient.topic.getTopics.query).toHaveBeenCalledWith(
        expect.objectContaining({ agentId: 'a1' }),
      );
    });

    it('should keep first page on the backend default offset', async () => {
      mockTrpcClient.topic.getTopics.query.mockResolvedValue([]);

      const program = createProgram();
      await program.parseAsync(['node', 'test', 'topic', 'list', '--agent-id', 'a1', '-L', '200']);

      expect(mockTrpcClient.topic.getTopics.query).toHaveBeenCalledWith(
        expect.objectContaining({ agentId: 'a1', pageSize: 200 }),
      );
    });

    it('should convert page 2 to current 1', async () => {
      mockTrpcClient.topic.getTopics.query.mockResolvedValue([]);

      const program = createProgram();
      await program.parseAsync([
        'node',
        'test',
        'topic',
        'list',
        '--agent-id',
        'a1',
        '--page',
        '2',
      ]);

      expect(mockTrpcClient.topic.getTopics.query).toHaveBeenCalledWith(
        expect.objectContaining({ agentId: 'a1', current: 1 }),
      );
    });

    it('should support the short page flag', async () => {
      mockTrpcClient.topic.getTopics.query.mockResolvedValue([]);

      const program = createProgram();
      await program.parseAsync(['node', 'test', 'topic', 'list', '--agent-id', 'a1', '-P', '2']);

      expect(mockTrpcClient.topic.getTopics.query).toHaveBeenCalledWith(
        expect.objectContaining({ agentId: 'a1', current: 1 }),
      );
    });
  });

  describe('search', () => {
    it('should search topics', async () => {
      mockTrpcClient.topic.searchTopics.query.mockResolvedValue([]);

      const program = createProgram();
      await program.parseAsync(['node', 'test', 'topic', 'search', 'hello']);

      expect(mockTrpcClient.topic.searchTopics.query).toHaveBeenCalledWith(
        expect.objectContaining({ keywords: 'hello' }),
      );
    });
  });

  describe('create', () => {
    it('should create a topic', async () => {
      mockTrpcClient.topic.createTopic.mutate.mockResolvedValue({ id: 't-new' });

      const program = createProgram();
      await program.parseAsync(['node', 'test', 'topic', 'create', '-t', 'New Topic']);

      expect(mockTrpcClient.topic.createTopic.mutate).toHaveBeenCalledWith(
        expect.objectContaining({ title: 'New Topic' }),
      );
    });
  });

  describe('edit', () => {
    it('should update a topic', async () => {
      mockTrpcClient.topic.updateTopic.mutate.mockResolvedValue({});

      const program = createProgram();
      await program.parseAsync(['node', 'test', 'topic', 'edit', 't1', '-t', 'Updated']);

      expect(mockTrpcClient.topic.updateTopic.mutate).toHaveBeenCalledWith({
        id: 't1',
        value: { title: 'Updated' },
      });
    });

    it('should exit when no changes', async () => {
      const program = createProgram();
      await program.parseAsync(['node', 'test', 'topic', 'edit', 't1']);

      expect(log.error).toHaveBeenCalledWith(expect.stringContaining('No changes'));
      expect(exitSpy).toHaveBeenCalledWith(1);
    });
  });

  describe('delete', () => {
    it('should delete single topic', async () => {
      mockTrpcClient.topic.removeTopic.mutate.mockResolvedValue({});

      const program = createProgram();
      await program.parseAsync(['node', 'test', 'topic', 'delete', 't1', '--yes']);

      expect(mockTrpcClient.topic.removeTopic.mutate).toHaveBeenCalledWith({ id: 't1' });
    });

    it('should batch delete multiple topics', async () => {
      mockTrpcClient.topic.batchDelete.mutate.mockResolvedValue({});

      const program = createProgram();
      await program.parseAsync(['node', 'test', 'topic', 'delete', 't1', 't2', '--yes']);

      expect(mockTrpcClient.topic.batchDelete.mutate).toHaveBeenCalledWith({
        ids: ['t1', 't2'],
      });
    });
  });

  describe('recent', () => {
    it('should list recent topics', async () => {
      mockTrpcClient.topic.recentTopics.query.mockResolvedValue([
        { id: 't1', title: 'Recent', updatedAt: new Date().toISOString() },
      ]);

      const program = createProgram();
      await program.parseAsync(['node', 'test', 'topic', 'recent']);

      expect(mockTrpcClient.topic.recentTopics.query).toHaveBeenCalledWith({ limit: 10 });
    });
  });
});

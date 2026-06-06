import { Command } from 'commander';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { log } from '../utils/logger';
import { registerTopicCommand } from './topic';

const { mockTrpcClient } = vi.hoisted(() => ({
  mockTrpcClient: {
    message: {
      getMessages: { query: vi.fn() },
    },
    topic: {
      batchDelete: { mutate: vi.fn() },
      createTopic: { mutate: vi.fn() },
      getTopicDetail: { query: vi.fn() },
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
    for (const method of Object.values(mockTrpcClient.message)) {
      for (const fn of Object.values(method)) {
        (fn as ReturnType<typeof vi.fn>).mockReset();
      }
    }
    // Default stub for getTopicDetail
    mockTrpcClient.topic.getTopicDetail.query.mockResolvedValue({
      favorite: false,
      id: 't1',
      title: 'Test Topic',
      updatedAt: new Date().toISOString(),
    });
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

  describe('view', () => {
    it('should display topic metadata and messages', async () => {
      mockTrpcClient.message.getMessages.query.mockResolvedValue([
        { content: 'Hello world', id: 'm1', role: 'user' },
        { content: 'Hi there', id: 'm2', role: 'assistant' },
      ]);

      const program = createProgram();
      await program.parseAsync(['node', 'test', 'topic', 'view', 't1']);

      expect(mockTrpcClient.topic.getTopicDetail.query).toHaveBeenCalledWith(
        expect.objectContaining({ id: 't1' }),
      );
      expect(mockTrpcClient.message.getMessages.query).toHaveBeenCalledWith(
        expect.objectContaining({ topicId: 't1' }),
      );
      expect(consoleSpy).toHaveBeenCalled();
    });

    it('should skip message query entirely when --no-messages flag is set', async () => {
      const program = createProgram();
      await program.parseAsync(['node', 'test', 'topic', 'view', 't1', '--no-messages']);

      // getTopicDetail is still called (for metadata)
      expect(mockTrpcClient.topic.getTopicDetail.query).toHaveBeenCalled();
      // but getMessages must NOT be called
      expect(mockTrpcClient.message.getMessages.query).not.toHaveBeenCalled();
    });

    it('should output json when --json flag is set', async () => {
      mockTrpcClient.message.getMessages.query.mockResolvedValue([
        { content: 'Hello', id: 'm1', role: 'user' },
      ]);

      const program = createProgram();
      await program.parseAsync(['node', 'test', 'topic', 'view', 't1', '--json']);

      const calls = consoleSpy.mock.calls.flat().join('');
      const parsed = JSON.parse(calls);
      expect(parsed.topic.id).toBe('t1');
      expect(parsed.messages).toHaveLength(1);
      expect(parsed.messages[0]).toHaveProperty('role', 'user');
      expect(parsed.messages[0]).toHaveProperty('content', 'Hello');
    });

    it('should output json with empty messages for --no-messages --json', async () => {
      const program = createProgram();
      await program.parseAsync(['node', 'test', 'topic', 'view', 't1', '--no-messages', '--json']);

      expect(mockTrpcClient.message.getMessages.query).not.toHaveBeenCalled();
      const calls = consoleSpy.mock.calls.flat().join('');
      const parsed = JSON.parse(calls);
      expect(parsed.topic.id).toBe('t1');
      expect(parsed.messages).toHaveLength(0);
    });

    it('should respect -L for message page size', async () => {
      mockTrpcClient.message.getMessages.query.mockResolvedValue([]);

      const program = createProgram();
      await program.parseAsync(['node', 'test', 'topic', 'view', 't1', '-L', '10']);

      expect(mockTrpcClient.message.getMessages.query).toHaveBeenCalledWith(
        expect.objectContaining({ pageSize: 10, topicId: 't1' }),
      );
    });

    it('should slice messages with --from and --to', async () => {
      mockTrpcClient.message.getMessages.query.mockResolvedValue([
        { content: 'msg1', id: 'm1', role: 'user' },
        { content: 'msg2', id: 'm2', role: 'assistant' },
        { content: 'msg3', id: 'm3', role: 'user' },
      ]);

      const program = createProgram();
      await program.parseAsync(['node', 'test', 'topic', 'view', 't1', '--from', '2', '--to', '3']);

      // Should print only m2 and m3 (index 1 and 2)
      const output = consoleSpy.mock.calls.flat().join('\n');
      expect(output).toContain('msg2');
      expect(output).toContain('msg3');
      expect(output).not.toContain('msg1');
    });

    it('should render tool calls inline', async () => {
      mockTrpcClient.message.getMessages.query.mockResolvedValue([
        {
          content: "I'll search for that.",
          id: 'm1',
          role: 'assistant',
          tools: [
            {
              function: { arguments: '{"query":"lobehub"}', name: 'web_search' },
              id: 'call_1',
              type: 'function',
            },
          ],
        },
        { content: 'search results...', id: 'm2', role: 'tool' },
      ]);

      const program = createProgram();
      await program.parseAsync(['node', 'test', 'topic', 'view', 't1']);

      const output = consoleSpy.mock.calls.flat().join('\n');
      expect(output).toContain('web_search');
      expect(output).toContain('lobehub');
    });

    it('should render threaded messages with indentation', async () => {
      mockTrpcClient.message.getMessages.query.mockResolvedValue([
        { content: 'Parent message', id: 'm1', parentId: null, role: 'user' },
        { content: 'Thread reply', id: 'm2', parentId: 'm1', role: 'assistant' },
      ]);

      const program = createProgram();
      await program.parseAsync(['node', 'test', 'topic', 'view', 't1']);

      const output = consoleSpy.mock.calls.flat().join('\n');
      expect(output).toContain('Parent message');
      expect(output).toContain('Thread reply');
      // thread reply should appear after parent (basic ordering check)
      expect(output.indexOf('Thread reply')).toBeGreaterThan(output.indexOf('Parent message'));
    });
  });
});

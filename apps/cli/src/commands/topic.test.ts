import { Command } from 'commander';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { log } from '../utils/logger';
import { registerTopicCommand } from './topic';

const { mockTrpcClient } = vi.hoisted(() => ({
  mockTrpcClient: {
    topic: {
      batchDelete: { mutate: vi.fn() },
      createTopic: { mutate: vi.fn() },
      getTopicTranscript: { query: vi.fn() },
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
    vi.clearAllMocks();
    exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {}) as any);
    consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    mockGetTrpcClient.mockResolvedValue(mockTrpcClient);
    for (const method of Object.values(mockTrpcClient.topic)) {
      for (const fn of Object.values(method)) {
        (fn as ReturnType<typeof vi.fn>).mockReset();
      }
    }
    mockTrpcClient.topic.getTopicTranscript.query.mockResolvedValue({
      items: [],
      topic: {
        favorite: false,
        id: 't1',
        title: 'Test Topic',
        updatedAt: new Date().toISOString(),
      },
      total: 0,
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
    const topicDetail = {
      favorite: true,
      id: 't1',
      model: 'gpt-test',
      provider: 'test-provider',
      status: 'completed',
      title: 'Test Topic',
      updatedAt: new Date('2026-01-01T00:00:00.000Z').toISOString(),
    };

    const message = (overrides: Record<string, unknown> = {}) => ({
      content: 'Hello world',
      createdAt: new Date('2026-01-01T00:00:00.000Z').toISOString(),
      id: 'm1',
      messageGroupId: null,
      parentId: null,
      role: 'user',
      threadId: null,
      tools: null,
      ...overrides,
    });

    const output = () => consoleSpy.mock.calls.map(([line]) => String(line)).join('\n');

    it('renders metadata and the transcript returned by the aggregate endpoint', async () => {
      mockTrpcClient.topic.getTopicTranscript.query.mockResolvedValue({
        items: [message(), message({ content: 'Hi there', id: 'm2', role: 'assistant' })],
        topic: topicDetail,
        total: 2,
      });

      await createProgram().parseAsync(['node', 'test', 'topic', 'view', 't1']);

      expect(mockTrpcClient.topic.getTopicTranscript.query).toHaveBeenCalledWith({
        includeMessages: true,
        limit: 50,
        offset: 0,
        topicId: 't1',
      });
      expect(output()).toContain('Test Topic');
      expect(output()).toContain('Hello world');
      expect(output()).toContain('Hi there');
      expect(output()).toContain('Showing 1–2 of 2');
    });

    it('uses the aggregate endpoint without loading messages for --no-messages', async () => {
      mockTrpcClient.topic.getTopicTranscript.query.mockResolvedValue({
        items: [],
        topic: topicDetail,
        total: null,
      });

      await createProgram().parseAsync(['node', 'test', 'topic', 'view', 't1', '--no-messages']);

      expect(mockTrpcClient.topic.getTopicTranscript.query).toHaveBeenCalledWith({
        includeMessages: false,
        limit: 50,
        offset: 0,
        topicId: 't1',
      });
      expect(output()).toContain('Test Topic');
      expect(output()).toContain('(messages skipped)');
    });

    it('keeps one stable JSON shape for transcript output', async () => {
      mockTrpcClient.topic.getTopicTranscript.query.mockResolvedValue({
        items: [message({ content: 'JSON message' })],
        topic: topicDetail,
        total: 75,
      });

      await createProgram().parseAsync(['node', 'test', 'topic', 'view', 't1', '--json']);

      const parsed = JSON.parse(output());
      expect(Object.keys(parsed)).toEqual(['messages', 'pagination', 'topic']);
      expect(parsed.messages[0]).toMatchObject({ content: 'JSON message', role: 'user' });
      expect(parsed.pagination).toEqual({ from: 1, limit: 50, to: 1, total: 75 });
      expect(parsed.topic).toMatchObject({ id: 't1', title: 'Test Topic' });
    });

    it('keeps the same JSON shape when messages are skipped', async () => {
      mockTrpcClient.topic.getTopicTranscript.query.mockResolvedValue({
        items: [],
        topic: topicDetail,
        total: null,
      });

      await createProgram().parseAsync([
        'node',
        'test',
        'topic',
        'view',
        't1',
        '--no-messages',
        '--json',
      ]);

      const parsed = JSON.parse(output());
      expect(Object.keys(parsed)).toEqual(['messages', 'pagination', 'topic']);
      expect(parsed).toMatchObject({ messages: [], pagination: null });
      expect(parsed.topic).toMatchObject({ id: 't1', title: 'Test Topic' });
    });

    it('maps --from to a server-side offset instead of slicing the first page', async () => {
      mockTrpcClient.topic.getTopicTranscript.query.mockResolvedValue({
        items: [message({ content: 'Message 51', id: 'm51' })],
        topic: topicDetail,
        total: 100,
      });

      await createProgram().parseAsync(['node', 'test', 'topic', 'view', 't1', '--from', '51']);

      expect(mockTrpcClient.topic.getTopicTranscript.query).toHaveBeenCalledWith(
        expect.objectContaining({ limit: 50, offset: 50 }),
      );
      expect(output()).toContain('Message 51');
      expect(output()).toContain('Showing 51–51 of 100. Next: --from 52 -L 50');
    });

    it('turns an inclusive --from/--to range into an exact server page', async () => {
      mockTrpcClient.topic.getTopicTranscript.query.mockResolvedValue({
        items: [message({ id: 'm51' }), message({ id: 'm52' })],
        topic: topicDetail,
        total: 100,
      });

      await createProgram().parseAsync([
        'node',
        'test',
        'topic',
        'view',
        't1',
        '--from',
        '51',
        '--to',
        '52',
      ]);

      expect(mockTrpcClient.topic.getTopicTranscript.query).toHaveBeenCalledWith(
        expect.objectContaining({ limit: 2, offset: 50 }),
      );
    });

    it.each([
      ['--from', '10x'],
      ['--from', '0'],
      ['--limit', '-1'],
      ['--limit', '1.5'],
      ['--limit', '501'],
    ])('rejects invalid numeric input %s %s', async (option, value) => {
      exitSpy.mockImplementation((() => {
        throw new Error('process.exit');
      }) as any);

      await expect(
        createProgram().parseAsync(['node', 'test', 'topic', 'view', 't1', option, value]),
      ).rejects.toThrow('process.exit');

      expect(log.error).toHaveBeenCalled();
      expect(mockTrpcClient.topic.getTopicTranscript.query).not.toHaveBeenCalled();
    });

    it.each([
      ['--from', '5', '--to', '4'],
      ['--from', '1', '--to', '501'],
      ['--limit', '10', '--to', '20'],
    ])('rejects an invalid range: %s %s %s %s', async (...args) => {
      exitSpy.mockImplementation((() => {
        throw new Error('process.exit');
      }) as any);

      await expect(
        createProgram().parseAsync(['node', 'test', 'topic', 'view', 't1', ...args]),
      ).rejects.toThrow('process.exit');

      expect(log.error).toHaveBeenCalled();
      expect(mockTrpcClient.topic.getTopicTranscript.query).not.toHaveBeenCalled();
    });

    it('propagates a missing-topic error instead of returning a successful empty topic', async () => {
      mockTrpcClient.topic.getTopicTranscript.query.mockRejectedValue(
        new Error('Topic not found: missing-topic'),
      );

      await expect(
        createProgram().parseAsync(['node', 'test', 'topic', 'view', 'missing-topic']),
      ).rejects.toThrow('Topic not found: missing-topic');

      expect(consoleSpy).not.toHaveBeenCalled();
    });

    it('renders the persisted ChatToolPayload shape', async () => {
      mockTrpcClient.topic.getTopicTranscript.query.mockResolvedValue({
        items: [
          message({
            role: 'assistant',
            tools: [
              {
                apiName: 'search',
                arguments: '{"query":"lobehub"}',
                id: 'call_1',
                identifier: 'web',
                type: 'default',
              },
            ],
          }),
        ],
        topic: topicDetail,
        total: 1,
      });

      await createProgram().parseAsync(['node', 'test', 'topic', 'view', 't1']);

      expect(output()).toContain('web.search');
      expect(output()).toContain('lobehub');
    });

    it('preserves group-chat roles and marks real thread messages', async () => {
      mockTrpcClient.topic.getTopicTranscript.query.mockResolvedValue({
        items: [
          message({ content: 'Supervisor message', id: 'm1', role: 'supervisor' }),
          message({ content: 'Task message', id: 'm2', role: 'task', threadId: 'thread-1' }),
          message({ content: 'Verify message', id: 'm3', role: 'verify' }),
        ],
        topic: topicDetail,
        total: 3,
      });

      await createProgram().parseAsync(['node', 'test', 'topic', 'view', 't1']);

      expect(output()).toContain('supervisor');
      expect(output()).toContain('task');
      expect(output()).toContain('verify');
      expect(output()).toContain('[thread thread-1]');
      expect(output().indexOf('Task message')).toBeGreaterThan(
        output().indexOf('Supervisor message'),
      );
    });

    it('sanitizes terminal controls, redacts base64 data, and bounds long output', async () => {
      mockTrpcClient.topic.getTopicTranscript.query.mockResolvedValue({
        items: [
          message({
            content: `safe\u001B[31m text data:image/png;base64,${'A'.repeat(100)}`,
            id: 'unsafe',
          }),
          message({ content: `${'x'.repeat(20_001)}SECRET_END`, id: 'long' }),
          message({
            id: 'tool-args',
            role: 'assistant',
            tools: [
              {
                apiName: 'large',
                arguments: `${'y'.repeat(8_001)}TOOL_SECRET`,
                id: 'call-large',
                identifier: 'test',
                type: 'default',
              },
            ],
          }),
        ],
        topic: topicDetail,
        total: 3,
      });

      await createProgram().parseAsync(['node', 'test', 'topic', 'view', 't1']);

      expect(output()).not.toContain('\u001B');
      expect(output()).not.toContain('data:image/png;base64');
      expect(output()).not.toContain('SECRET_END');
      expect(output()).not.toContain('TOOL_SECRET');
      expect(output()).toContain('[base64 data omitted]');
      expect(output()).toContain('[message content truncated; use --json for full output]');
      expect(output()).toContain('[tool arguments omitted:');
    });

    it('distinguishes an empty topic from an out-of-range page', async () => {
      mockTrpcClient.topic.getTopicTranscript.query.mockResolvedValueOnce({
        items: [],
        topic: topicDetail,
        total: 0,
      });

      await createProgram().parseAsync(['node', 'test', 'topic', 'view', 't1']);
      expect(output()).toContain('(no messages)');
      expect(output()).not.toContain('requested range');

      consoleSpy.mockClear();
      mockTrpcClient.topic.getTopicTranscript.query.mockResolvedValueOnce({
        items: [],
        topic: topicDetail,
        total: 100,
      });

      await createProgram().parseAsync(['node', 'test', 'topic', 'view', 't1', '--from', '101']);
      expect(output()).toContain('(no messages in requested range; topic has 100 messages)');
    });
  });
});

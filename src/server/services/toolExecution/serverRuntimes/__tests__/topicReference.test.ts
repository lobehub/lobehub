import { TopicReferenceIdentifier } from '@lobechat/builtin-tool-topic-reference';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { type ToolExecutionContext } from '../../types';

// Mock database models
const mockTopicModelFindById = vi.fn();
const mockMessageModelQuery = vi.fn();

vi.mock('@/database/models/topic', () => ({
  TopicModel: vi.fn().mockImplementation(() => ({
    findById: (...args: any[]) => mockTopicModelFindById(...args),
  })),
}));

vi.mock('@/database/models/message', () => ({
  MessageModel: vi.fn().mockImplementation(() => ({
    query: (...args: any[]) => mockMessageModelQuery(...args),
  })),
}));

// Import after mock setup
const { topicReferenceRuntime } = await import('../topicReference');

describe('topicReferenceRuntime', () => {
  it('should have the correct identifier', () => {
    expect(topicReferenceRuntime.identifier).toBe(TopicReferenceIdentifier);
    expect(topicReferenceRuntime.identifier).toBe('lobe-topic-reference');
  });

  describe('factory', () => {
    it('should throw when serverDB is missing', () => {
      const context: ToolExecutionContext = {
        toolManifestMap: {},
        userId: 'user-1',
      };

      expect(() => topicReferenceRuntime.factory(context)).toThrow(
        'serverDB is required for TopicReference execution',
      );
    });

    it('should throw when userId is missing', () => {
      const context: ToolExecutionContext = {
        serverDB: {} as any,
        toolManifestMap: {},
      };

      expect(() => topicReferenceRuntime.factory(context)).toThrow(
        'userId is required for TopicReference execution',
      );
    });

    it('should create a runtime with getTopicContext method', () => {
      const context: ToolExecutionContext = {
        serverDB: {} as any,
        toolManifestMap: {},
        userId: 'user-1',
      };

      const runtime = topicReferenceRuntime.factory(context);
      expect(runtime).toBeDefined();
      expect(typeof runtime.getTopicContext).toBe('function');
    });
  });

  describe('getTopicContext', () => {
    let runtime: any;

    beforeEach(() => {
      vi.clearAllMocks();

      const context: ToolExecutionContext = {
        serverDB: {} as any,
        toolManifestMap: {},
        userId: 'user-1',
      };

      runtime = topicReferenceRuntime.factory(context);
    });

    it('should return error when topicId is missing', async () => {
      const result = await runtime.getTopicContext({ topicId: '' });

      expect(result).toEqual({ content: 'topicId is required', success: false });
    });

    it('should return error when topicId is undefined', async () => {
      const result = await runtime.getTopicContext({ topicId: undefined });

      expect(result).toEqual({ content: 'topicId is required', success: false });
    });

    it('should return error when topic is not found', async () => {
      mockTopicModelFindById.mockResolvedValue(null);

      const result = await runtime.getTopicContext({ topicId: 'topic-123' });

      expect(result).toEqual({
        content: 'Topic not found: topic-123',
        success: false,
      });
      expect(mockTopicModelFindById).toHaveBeenCalledWith('topic-123');
    });

    it('should return historySummary when topic has one', async () => {
      mockTopicModelFindById.mockResolvedValue({
        historySummary: 'This is a summary of the conversation.',
        id: 'topic-123',
        title: 'My Topic',
      });

      const result = await runtime.getTopicContext({ topicId: 'topic-123' });

      expect(result).toEqual({
        content: '# Topic: My Topic\n\n## Summary\nThis is a summary of the conversation.',
        success: true,
      });
      // Should NOT fetch messages when summary exists
      expect(mockMessageModelQuery).not.toHaveBeenCalled();
    });

    it('should use "Untitled" when topic has no title and has historySummary', async () => {
      mockTopicModelFindById.mockResolvedValue({
        historySummary: 'Summary content',
        id: 'topic-123',
        title: null,
      });

      const result = await runtime.getTopicContext({ topicId: 'topic-123' });

      expect(result.content).toContain('# Topic: Untitled');
      expect(result.success).toBe(true);
    });

    it('should fallback to messages when topic has no historySummary', async () => {
      mockTopicModelFindById.mockResolvedValue({
        agentId: 'agent-1',
        groupId: 'group-1',
        id: 'topic-123',
        title: 'Chat Topic',
      });

      mockMessageModelQuery.mockResolvedValue([
        { content: 'Hello', role: 'user' },
        { content: 'Hi there!', role: 'assistant' },
      ]);

      const result = await runtime.getTopicContext({ topicId: 'topic-123' });

      expect(result.success).toBe(true);
      expect(result.content).toContain('# Topic: Chat Topic');
      expect(result.content).toContain('## Recent Messages');
      expect(result.content).toContain('**User**: Hello');
      expect(result.content).toContain('**Assistant**: Hi there!');

      expect(mockMessageModelQuery).toHaveBeenCalledWith({
        agentId: 'agent-1',
        groupId: 'group-1',
        topicId: 'topic-123',
      });
    });

    it('should pass undefined agentId/groupId when topic has none', async () => {
      mockTopicModelFindById.mockResolvedValue({
        id: 'topic-123',
        title: 'Simple Topic',
      });

      mockMessageModelQuery.mockResolvedValue([]);

      await runtime.getTopicContext({ topicId: 'topic-123' });

      expect(mockMessageModelQuery).toHaveBeenCalledWith({
        agentId: undefined,
        groupId: undefined,
        topicId: 'topic-123',
      });
    });

    it('should limit messages to last 30', async () => {
      mockTopicModelFindById.mockResolvedValue({
        id: 'topic-123',
        title: 'Long Chat',
      });

      // Create 35 messages with unique identifiable content
      const messages = Array.from({ length: 35 }, (_, i) => ({
        content: `UniqueMsg-${String(i + 1).padStart(3, '0')}`,
        role: 'user',
      }));
      mockMessageModelQuery.mockResolvedValue(messages);

      const result = await runtime.getTopicContext({ topicId: 'topic-123' });

      expect(result.success).toBe(true);
      // Should only contain last 30 messages (indices 5-34, i.e. UniqueMsg-006 to UniqueMsg-035)
      expect(result.content).not.toContain('UniqueMsg-001');
      expect(result.content).not.toContain('UniqueMsg-005');
      expect(result.content).toContain('UniqueMsg-006');
      expect(result.content).toContain('UniqueMsg-035');
    });

    it('should skip messages with empty content', async () => {
      mockTopicModelFindById.mockResolvedValue({
        id: 'topic-123',
        title: 'Topic',
      });

      mockMessageModelQuery.mockResolvedValue([
        { content: 'Valid message', role: 'user' },
        { content: '', role: 'assistant' },
        { content: '   ', role: 'user' },
        { content: 'Another message', role: 'assistant' },
      ]);

      const result = await runtime.getTopicContext({ topicId: 'topic-123' });

      expect(result.content).toContain('**User**: Valid message');
      expect(result.content).toContain('**Assistant**: Another message');
      // Empty/whitespace messages should not appear
      const lines = result.content.split('\n').filter((l: string) => l.trim());
      const messageLines = lines.filter((l: string) => l.startsWith('**'));
      expect(messageLines).toHaveLength(2);
    });

    it('should handle non-user and non-assistant roles', async () => {
      mockTopicModelFindById.mockResolvedValue({
        id: 'topic-123',
        title: 'Topic',
      });

      mockMessageModelQuery.mockResolvedValue([
        { content: 'System message', role: 'system' },
        { content: 'Tool result', role: 'tool' },
      ]);

      const result = await runtime.getTopicContext({ topicId: 'topic-123' });

      expect(result.success).toBe(true);
      expect(result.content).toContain('**system**: System message');
      expect(result.content).toContain('**tool**: Tool result');
    });

    it('should return error when topic model throws', async () => {
      const error = new Error('Database connection failed');
      mockTopicModelFindById.mockRejectedValue(error);

      const result = await runtime.getTopicContext({ topicId: 'topic-123' });

      expect(result.success).toBe(false);
      expect(result.content).toContain('Failed to fetch topic context: Database connection failed');
      expect(result.error).toBe(error);
    });

    it('should return error when message model throws', async () => {
      mockTopicModelFindById.mockResolvedValue({
        id: 'topic-123',
        title: 'Topic',
      });

      const error = new Error('Query failed');
      mockMessageModelQuery.mockRejectedValue(error);

      const result = await runtime.getTopicContext({ topicId: 'topic-123' });

      expect(result.success).toBe(false);
      expect(result.content).toContain('Failed to fetch topic context: Query failed');
      expect(result.error).toBe(error);
    });

    it('should handle non-Error exceptions', async () => {
      mockTopicModelFindById.mockRejectedValue('string error');

      const result = await runtime.getTopicContext({ topicId: 'topic-123' });

      expect(result.success).toBe(false);
      expect(result.content).toContain('Failed to fetch topic context: string error');
    });

    it('should handle null message content', async () => {
      mockTopicModelFindById.mockResolvedValue({
        id: 'topic-123',
        title: 'Topic',
      });

      mockMessageModelQuery.mockResolvedValue([
        { content: null, role: 'user' },
        { content: 'Real message', role: 'assistant' },
      ]);

      const result = await runtime.getTopicContext({ topicId: 'topic-123' });

      expect(result.success).toBe(true);
      // null content should be treated as empty and skipped
      const messageLines = result.content.split('\n').filter((l: string) => l.startsWith('**'));
      expect(messageLines).toHaveLength(1);
      expect(result.content).toContain('**Assistant**: Real message');
    });
  });
});

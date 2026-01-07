import { describe, expect, it } from 'vitest';

import { buildHelperMaps } from '../indexing';
import type { Message, MessageGroupMetadata } from '../types';

describe('buildHelperMaps', () => {
  describe('messageMap', () => {
    it('should build messageMap for O(1) access', () => {
      const messages: Message[] = [
        {
          content: 'Hello',
          createdAt: 1000,
          id: 'msg-1',
          role: 'user',
          updatedAt: 1000,
        },
        {
          content: 'Hi there',
          createdAt: 2000,
          id: 'msg-2',
          parentId: 'msg-1',
          role: 'assistant',
          updatedAt: 2000,
        },
      ];

      const result = buildHelperMaps(messages);

      expect(result.messageMap.size).toBe(2);
      expect(result.messageMap.get('msg-1')).toEqual(messages[0]);
      expect(result.messageMap.get('msg-2')).toEqual(messages[1]);
    });

    it('should handle empty messages array', () => {
      const result = buildHelperMaps([]);

      expect(result.messageMap.size).toBe(0);
    });

    it('should handle single message', () => {
      const messages: Message[] = [
        {
          content: 'Single message',
          createdAt: 1000,
          id: 'msg-1',
          role: 'user',
          updatedAt: 1000,
        },
      ];

      const result = buildHelperMaps(messages);

      expect(result.messageMap.size).toBe(1);
      expect(result.messageMap.get('msg-1')).toEqual(messages[0]);
    });
  });

  describe('childrenMap', () => {
    it('should build childrenMap for parent-child relationships', () => {
      const messages: Message[] = [
        {
          content: 'Root',
          createdAt: 1000,
          id: 'msg-1',
          role: 'user',
          updatedAt: 1000,
        },
        {
          content: 'Child 1',
          createdAt: 2000,
          id: 'msg-2',
          parentId: 'msg-1',
          role: 'assistant',
          updatedAt: 2000,
        },
        {
          content: 'Child 2',
          createdAt: 3000,
          id: 'msg-3',
          parentId: 'msg-1',
          role: 'assistant',
          updatedAt: 3000,
        },
      ];

      const result = buildHelperMaps(messages);

      expect(result.childrenMap.get(null)).toEqual(['msg-1']);
      expect(result.childrenMap.get('msg-1')).toEqual(['msg-2', 'msg-3']);
    });

    it('should handle messages with no parent (root messages)', () => {
      const messages: Message[] = [
        {
          content: 'Root 1',
          createdAt: 1000,
          id: 'msg-1',
          role: 'user',
          updatedAt: 1000,
        },
        {
          content: 'Root 2',
          createdAt: 2000,
          id: 'msg-2',
          role: 'user',
          updatedAt: 2000,
        },
      ];

      const result = buildHelperMaps(messages);

      expect(result.childrenMap.get(null)).toEqual(['msg-1', 'msg-2']);
    });

    it('should handle deeply nested parent-child relationships', () => {
      const messages: Message[] = [
        {
          content: 'Level 0',
          createdAt: 1000,
          id: 'msg-1',
          role: 'user',
          updatedAt: 1000,
        },
        {
          content: 'Level 1',
          createdAt: 2000,
          id: 'msg-2',
          parentId: 'msg-1',
          role: 'assistant',
          updatedAt: 2000,
        },
        {
          content: 'Level 2',
          createdAt: 3000,
          id: 'msg-3',
          parentId: 'msg-2',
          role: 'user',
          updatedAt: 3000,
        },
        {
          content: 'Level 3',
          createdAt: 4000,
          id: 'msg-4',
          parentId: 'msg-3',
          role: 'assistant',
          updatedAt: 4000,
        },
      ];

      const result = buildHelperMaps(messages);

      expect(result.childrenMap.get(null)).toEqual(['msg-1']);
      expect(result.childrenMap.get('msg-1')).toEqual(['msg-2']);
      expect(result.childrenMap.get('msg-2')).toEqual(['msg-3']);
      expect(result.childrenMap.get('msg-3')).toEqual(['msg-4']);
    });

    it('should handle branching conversations', () => {
      const messages: Message[] = [
        {
          content: 'Root',
          createdAt: 1000,
          id: 'msg-1',
          role: 'user',
          updatedAt: 1000,
        },
        {
          content: 'Branch 1',
          createdAt: 2000,
          id: 'msg-2',
          parentId: 'msg-1',
          role: 'assistant',
          updatedAt: 2000,
        },
        {
          content: 'Branch 2',
          createdAt: 3000,
          id: 'msg-3',
          parentId: 'msg-1',
          role: 'assistant',
          updatedAt: 3000,
        },
        {
          content: 'Sub-branch 1',
          createdAt: 4000,
          id: 'msg-4',
          parentId: 'msg-2',
          role: 'user',
          updatedAt: 4000,
        },
        {
          content: 'Sub-branch 2',
          createdAt: 5000,
          id: 'msg-5',
          parentId: 'msg-2',
          role: 'user',
          updatedAt: 5000,
        },
      ];

      const result = buildHelperMaps(messages);

      expect(result.childrenMap.get(null)).toEqual(['msg-1']);
      expect(result.childrenMap.get('msg-1')).toEqual(['msg-2', 'msg-3']);
      expect(result.childrenMap.get('msg-2')).toEqual(['msg-4', 'msg-5']);
    });
  });

  describe('threadMap', () => {
    it('should build threadMap for messages with threadId', () => {
      const messages: Message[] = [
        {
          content: 'Main message',
          createdAt: 1000,
          id: 'msg-1',
          role: 'user',
          updatedAt: 1000,
        },
        {
          content: 'Thread message 1',
          createdAt: 2000,
          id: 'msg-2',
          parentId: 'msg-1',
          role: 'assistant',
          threadId: 'thread-1',
          updatedAt: 2000,
        },
        {
          content: 'Thread message 2',
          createdAt: 3000,
          id: 'msg-3',
          parentId: 'msg-2',
          role: 'user',
          threadId: 'thread-1',
          updatedAt: 3000,
        },
      ];

      const result = buildHelperMaps(messages);

      expect(result.threadMap.size).toBe(1);
      expect(result.threadMap.get('thread-1')).toHaveLength(2);
      expect(result.threadMap.get('thread-1')).toEqual([messages[1], messages[2]]);
    });

    it('should handle multiple threads', () => {
      const messages: Message[] = [
        {
          content: 'Thread 1 - msg 1',
          createdAt: 1000,
          id: 'msg-1',
          role: 'user',
          threadId: 'thread-1',
          updatedAt: 1000,
        },
        {
          content: 'Thread 1 - msg 2',
          createdAt: 2000,
          id: 'msg-2',
          role: 'assistant',
          threadId: 'thread-1',
          updatedAt: 2000,
        },
        {
          content: 'Thread 2 - msg 1',
          createdAt: 3000,
          id: 'msg-3',
          role: 'user',
          threadId: 'thread-2',
          updatedAt: 3000,
        },
      ];

      const result = buildHelperMaps(messages);

      expect(result.threadMap.size).toBe(2);
      expect(result.threadMap.get('thread-1')).toEqual([messages[0], messages[1]]);
      expect(result.threadMap.get('thread-2')).toEqual([messages[2]]);
    });

    it('should not include messages without threadId in threadMap', () => {
      const messages: Message[] = [
        {
          content: 'No thread',
          createdAt: 1000,
          id: 'msg-1',
          role: 'user',
          updatedAt: 1000,
        },
        {
          content: 'With thread',
          createdAt: 2000,
          id: 'msg-2',
          role: 'assistant',
          threadId: 'thread-1',
          updatedAt: 2000,
        },
      ];

      const result = buildHelperMaps(messages);

      expect(result.threadMap.size).toBe(1);
      expect(result.threadMap.get('thread-1')).toEqual([messages[1]]);
    });

    it('should handle empty threadMap when no messages have threadId', () => {
      const messages: Message[] = [
        {
          content: 'Message 1',
          createdAt: 1000,
          id: 'msg-1',
          role: 'user',
          updatedAt: 1000,
        },
        {
          content: 'Message 2',
          createdAt: 2000,
          id: 'msg-2',
          role: 'assistant',
          updatedAt: 2000,
        },
      ];

      const result = buildHelperMaps(messages);

      expect(result.threadMap.size).toBe(0);
    });
  });

  describe('messageGroupMap', () => {
    it('should build messageGroupMap from provided metadata', () => {
      const messages: Message[] = [
        {
          content: 'Message',
          createdAt: 1000,
          id: 'msg-1',
          role: 'user',
          updatedAt: 1000,
        },
      ];

      const messageGroups: MessageGroupMetadata[] = [
        {
          id: 'group-1',
          mode: 'compare',
        },
        {
          id: 'group-2',
          mode: 'summary',
        },
      ];

      const result = buildHelperMaps(messages, messageGroups);

      expect(result.messageGroupMap.size).toBe(2);
      expect(result.messageGroupMap.get('group-1')).toEqual(messageGroups[0]);
      expect(result.messageGroupMap.get('group-2')).toEqual(messageGroups[1]);
    });

    it('should handle empty messageGroupMap when no metadata provided', () => {
      const messages: Message[] = [
        {
          content: 'Message',
          createdAt: 1000,
          id: 'msg-1',
          role: 'user',
          updatedAt: 1000,
        },
      ];

      const result = buildHelperMaps(messages);

      expect(result.messageGroupMap.size).toBe(0);
    });

    it('should handle empty messageGroupMap when empty array provided', () => {
      const messages: Message[] = [
        {
          content: 'Message',
          createdAt: 1000,
          id: 'msg-1',
          role: 'user',
          updatedAt: 1000,
        },
      ];

      const result = buildHelperMaps(messages, []);

      expect(result.messageGroupMap.size).toBe(0);
    });
  });

  describe('integration scenarios', () => {
    it('should build all maps correctly in complex conversation', () => {
      const messages: Message[] = [
        {
          content: 'Root message',
          createdAt: 1000,
          id: 'msg-1',
          role: 'user',
          updatedAt: 1000,
        },
        {
          content: 'Assistant response',
          createdAt: 2000,
          groupId: 'group-1',
          id: 'msg-2',
          parentId: 'msg-1',
          role: 'assistant',
          updatedAt: 2000,
        },
        {
          content: 'Thread message',
          createdAt: 3000,
          id: 'msg-3',
          parentId: 'msg-2',
          role: 'user',
          threadId: 'thread-1',
          updatedAt: 3000,
        },
        {
          content: 'Branch message',
          createdAt: 4000,
          id: 'msg-4',
          parentId: 'msg-1',
          role: 'assistant',
          updatedAt: 4000,
        },
      ];

      const messageGroups: MessageGroupMetadata[] = [
        {
          id: 'group-1',
          mode: 'compare',
        },
      ];

      const result = buildHelperMaps(messages, messageGroups);

      // Verify messageMap
      expect(result.messageMap.size).toBe(4);

      // Verify childrenMap
      expect(result.childrenMap.get(null)).toEqual(['msg-1']);
      expect(result.childrenMap.get('msg-1')).toEqual(['msg-2', 'msg-4']);
      expect(result.childrenMap.get('msg-2')).toEqual(['msg-3']);

      // Verify threadMap
      expect(result.threadMap.size).toBe(1);
      expect(result.threadMap.get('thread-1')).toEqual([messages[2]]);

      // Verify messageGroupMap
      expect(result.messageGroupMap.size).toBe(1);
      expect(result.messageGroupMap.get('group-1')).toEqual(messageGroups[0]);
    });

    it('should handle large number of messages efficiently', () => {
      const messages: Message[] = Array.from({ length: 1000 }, (_, i) => ({
        content: `Message ${i}`,
        createdAt: i,
        id: `msg-${i}`,
        parentId: i > 0 ? `msg-${i - 1}` : undefined,
        role: i % 2 === 0 ? ('user' as const) : ('assistant' as const),
        updatedAt: i,
      }));

      const startTime = performance.now();
      const result = buildHelperMaps(messages);
      const endTime = performance.now();

      const executionTime = endTime - startTime;

      expect(result.messageMap.size).toBe(1000);
      expect(result.childrenMap.size).toBe(1000);
      expect(executionTime).toBeLessThan(50); // Should be fast
    });
  });
});

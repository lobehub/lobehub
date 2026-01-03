import { describe, expect, it } from 'vitest';

import { buildHelperMaps } from '../indexing';
import { buildIdTree } from '../structuring';
import type { Message } from '../types';

describe('buildIdTree', () => {
  describe('basic tree building', () => {
    it('should build tree from single root message', () => {
      const messages: Message[] = [
        {
          content: 'Root',
          createdAt: 1000,
          id: 'msg-1',
          role: 'user',
          updatedAt: 1000,
        },
      ];

      const helperMaps = buildHelperMaps(messages);
      const result = buildIdTree(helperMaps);

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({
        children: [],
        id: 'msg-1',
      });
    });

    it('should build tree with linear conversation', () => {
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
          parentId: 'msg-1',
          role: 'assistant',
          updatedAt: 2000,
        },
        {
          content: 'Message 3',
          createdAt: 3000,
          id: 'msg-3',
          parentId: 'msg-2',
          role: 'user',
          updatedAt: 3000,
        },
      ];

      const helperMaps = buildHelperMaps(messages);
      const result = buildIdTree(helperMaps);

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('msg-1');
      expect(result[0].children).toHaveLength(1);
      expect(result[0].children[0].id).toBe('msg-2');
      expect(result[0].children[0].children).toHaveLength(1);
      expect(result[0].children[0].children[0].id).toBe('msg-3');
    });

    it('should handle multiple root messages', () => {
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

      const helperMaps = buildHelperMaps(messages);
      const result = buildIdTree(helperMaps);

      expect(result).toHaveLength(2);
      expect(result[0].id).toBe('msg-1');
      expect(result[1].id).toBe('msg-2');
    });
  });

  describe('branching conversations', () => {
    it('should build tree with branches', () => {
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
      ];

      const helperMaps = buildHelperMaps(messages);
      const result = buildIdTree(helperMaps);

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('msg-1');
      expect(result[0].children).toHaveLength(2);
      expect(result[0].children[0].id).toBe('msg-2');
      expect(result[0].children[1].id).toBe('msg-3');
    });

    it('should handle nested branches', () => {
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
          content: 'Branch 1.1',
          createdAt: 3000,
          id: 'msg-3',
          parentId: 'msg-2',
          role: 'user',
          updatedAt: 3000,
        },
        {
          content: 'Branch 1.2',
          createdAt: 4000,
          id: 'msg-4',
          parentId: 'msg-2',
          role: 'user',
          updatedAt: 4000,
        },
      ];

      const helperMaps = buildHelperMaps(messages);
      const result = buildIdTree(helperMaps);

      expect(result).toHaveLength(1);
      expect(result[0].children[0].id).toBe('msg-2');
      expect(result[0].children[0].children).toHaveLength(2);
      expect(result[0].children[0].children[0].id).toBe('msg-3');
      expect(result[0].children[0].children[1].id).toBe('msg-4');
    });

    it('should handle deeply nested tree (4 levels)', () => {
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

      const helperMaps = buildHelperMaps(messages);
      const result = buildIdTree(helperMaps);

      expect(result).toHaveLength(1);

      let current = result[0];
      expect(current.id).toBe('msg-1');

      current = current.children[0];
      expect(current.id).toBe('msg-2');

      current = current.children[0];
      expect(current.id).toBe('msg-3');

      current = current.children[0];
      expect(current.id).toBe('msg-4');
      expect(current.children).toHaveLength(0);
    });
  });

  describe('thread handling', () => {
    it('should exclude messages with threadId from main tree', () => {
      const messages: Message[] = [
        {
          content: 'Root',
          createdAt: 1000,
          id: 'msg-1',
          role: 'user',
          updatedAt: 1000,
        },
        {
          content: 'Main flow',
          createdAt: 2000,
          id: 'msg-2',
          parentId: 'msg-1',
          role: 'assistant',
          updatedAt: 2000,
        },
        {
          content: 'Thread message',
          createdAt: 3000,
          id: 'msg-3',
          parentId: 'msg-1',
          role: 'assistant',
          threadId: 'thread-1',
          updatedAt: 3000,
        },
      ];

      const helperMaps = buildHelperMaps(messages);
      const result = buildIdTree(helperMaps);

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('msg-1');
      expect(result[0].children).toHaveLength(1);
      expect(result[0].children[0].id).toBe('msg-2');
    });

    it('should exclude root messages with threadId', () => {
      const messages: Message[] = [
        {
          content: 'Main root',
          createdAt: 1000,
          id: 'msg-1',
          role: 'user',
          updatedAt: 1000,
        },
        {
          content: 'Thread root',
          createdAt: 2000,
          id: 'msg-2',
          role: 'assistant',
          threadId: 'thread-1',
          updatedAt: 2000,
        },
      ];

      const helperMaps = buildHelperMaps(messages);
      const result = buildIdTree(helperMaps);

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('msg-1');
    });

    it('should filter out thread children at any level', () => {
      const messages: Message[] = [
        {
          content: 'Root',
          createdAt: 1000,
          id: 'msg-1',
          role: 'user',
          updatedAt: 1000,
        },
        {
          content: 'Main child',
          createdAt: 2000,
          id: 'msg-2',
          parentId: 'msg-1',
          role: 'assistant',
          updatedAt: 2000,
        },
        {
          content: 'Main grandchild',
          createdAt: 3000,
          id: 'msg-3',
          parentId: 'msg-2',
          role: 'user',
          updatedAt: 3000,
        },
        {
          content: 'Thread grandchild',
          createdAt: 4000,
          id: 'msg-4',
          parentId: 'msg-2',
          role: 'user',
          threadId: 'thread-1',
          updatedAt: 4000,
        },
      ];

      const helperMaps = buildHelperMaps(messages);
      const result = buildIdTree(helperMaps);

      expect(result).toHaveLength(1);
      expect(result[0].children[0].id).toBe('msg-2');
      expect(result[0].children[0].children).toHaveLength(1);
      expect(result[0].children[0].children[0].id).toBe('msg-3');
    });
  });

  describe('edge cases', () => {
    it('should handle empty messages', () => {
      const helperMaps = buildHelperMaps([]);
      const result = buildIdTree(helperMaps);

      expect(result).toEqual([]);
    });

    it('should handle messages with no children', () => {
      const messages: Message[] = [
        {
          content: 'Lone message',
          createdAt: 1000,
          id: 'msg-1',
          role: 'user',
          updatedAt: 1000,
        },
      ];

      const helperMaps = buildHelperMaps(messages);
      const result = buildIdTree(helperMaps);

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({
        children: [],
        id: 'msg-1',
      });
    });

    it('should handle messages with missing parent references', () => {
      const messages: Message[] = [
        {
          content: 'Orphan',
          createdAt: 1000,
          id: 'msg-1',
          parentId: 'non-existent',
          role: 'user',
          updatedAt: 1000,
        },
      ];

      const helperMaps = buildHelperMaps(messages);
      const result = buildIdTree(helperMaps);

      // Orphan messages without valid parents are not in main flow
      expect(result).toEqual([]);
    });

    it('should build correct tree when all messages are threaded', () => {
      const messages: Message[] = [
        {
          content: 'Thread 1',
          createdAt: 1000,
          id: 'msg-1',
          role: 'user',
          threadId: 'thread-1',
          updatedAt: 1000,
        },
        {
          content: 'Thread 2',
          createdAt: 2000,
          id: 'msg-2',
          role: 'assistant',
          threadId: 'thread-1',
          updatedAt: 2000,
        },
      ];

      const helperMaps = buildHelperMaps(messages);
      const result = buildIdTree(helperMaps);

      expect(result).toEqual([]);
    });
  });

  describe('complex scenarios', () => {
    it('should build tree with mixed branches and linear paths', () => {
      const messages: Message[] = [
        {
          content: 'Root',
          createdAt: 1000,
          id: 'msg-1',
          role: 'user',
          updatedAt: 1000,
        },
        {
          content: 'Branch A',
          createdAt: 2000,
          id: 'msg-2',
          parentId: 'msg-1',
          role: 'assistant',
          updatedAt: 2000,
        },
        {
          content: 'Branch A -> Child',
          createdAt: 3000,
          id: 'msg-3',
          parentId: 'msg-2',
          role: 'user',
          updatedAt: 3000,
        },
        {
          content: 'Branch B',
          createdAt: 4000,
          id: 'msg-4',
          parentId: 'msg-1',
          role: 'assistant',
          updatedAt: 4000,
        },
        {
          content: 'Branch B -> Child 1',
          createdAt: 5000,
          id: 'msg-5',
          parentId: 'msg-4',
          role: 'user',
          updatedAt: 5000,
        },
        {
          content: 'Branch B -> Child 2',
          createdAt: 6000,
          id: 'msg-6',
          parentId: 'msg-4',
          role: 'user',
          updatedAt: 6000,
        },
      ];

      const helperMaps = buildHelperMaps(messages);
      const result = buildIdTree(helperMaps);

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('msg-1');
      expect(result[0].children).toHaveLength(2);

      // Branch A
      expect(result[0].children[0].id).toBe('msg-2');
      expect(result[0].children[0].children).toHaveLength(1);
      expect(result[0].children[0].children[0].id).toBe('msg-3');

      // Branch B
      expect(result[0].children[1].id).toBe('msg-4');
      expect(result[0].children[1].children).toHaveLength(2);
      expect(result[0].children[1].children[0].id).toBe('msg-5');
      expect(result[0].children[1].children[1].id).toBe('msg-6');
    });

    it('should handle multiple root trees', () => {
      const messages: Message[] = [
        // Tree 1
        {
          content: 'Tree 1 Root',
          createdAt: 1000,
          id: 'msg-1',
          role: 'user',
          updatedAt: 1000,
        },
        {
          content: 'Tree 1 Child',
          createdAt: 2000,
          id: 'msg-2',
          parentId: 'msg-1',
          role: 'assistant',
          updatedAt: 2000,
        },
        // Tree 2
        {
          content: 'Tree 2 Root',
          createdAt: 3000,
          id: 'msg-3',
          role: 'user',
          updatedAt: 3000,
        },
        {
          content: 'Tree 2 Child',
          createdAt: 4000,
          id: 'msg-4',
          parentId: 'msg-3',
          role: 'assistant',
          updatedAt: 4000,
        },
      ];

      const helperMaps = buildHelperMaps(messages);
      const result = buildIdTree(helperMaps);

      expect(result).toHaveLength(2);
      expect(result[0].id).toBe('msg-1');
      expect(result[0].children[0].id).toBe('msg-2');
      expect(result[1].id).toBe('msg-3');
      expect(result[1].children[0].id).toBe('msg-4');
    });
  });

  describe('performance', () => {
    it('should build tree for large dataset efficiently', () => {
      const messages: Message[] = Array.from({ length: 1000 }, (_, i) => ({
        content: `Message ${i}`,
        createdAt: i,
        id: `msg-${i}`,
        parentId: i > 0 ? `msg-${i - 1}` : undefined,
        role: i % 2 === 0 ? ('user' as const) : ('assistant' as const),
        updatedAt: i,
      }));

      const helperMaps = buildHelperMaps(messages);

      const startTime = performance.now();
      const result = buildIdTree(helperMaps);
      const endTime = performance.now();

      const executionTime = endTime - startTime;

      expect(result).toHaveLength(1);
      expect(executionTime).toBeLessThan(50); // Should be fast
    });
  });
});

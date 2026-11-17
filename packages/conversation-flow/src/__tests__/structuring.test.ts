import { describe, expect, it } from 'vitest';

import { buildHelperMaps } from '../indexing';
import { buildIdTree } from '../structuring';
import type { Message } from '../types';

const createMessage = (
  id: string,
  role: Message['role'],
  content: string,
  createdAt: number,
  updatedAt: number,
): Message => ({
  content,
  createdAt,
  id,
  role,
  updatedAt,
});

const createChildMessage = (
  id: string,
  parentId: string,
  role: Message['role'],
  content: string,
  createdAt: number,
  updatedAt: number,
): Message => ({
  content,
  createdAt,
  id,
  parentId,
  role,
  updatedAt,
});

describe('buildIdTree', () => {
  describe('basic tree building', () => {
    it('should build tree from single root message', () => {
      const messages: Message[] = [createMessage('msg-1', 'user', 'Root', 1000, 1000)];

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
        createMessage('msg-1', 'user', 'Message 1', 1000, 1000),
        createChildMessage('msg-2', 'msg-1', 'assistant', 'Message 2', 2000, 2000),
        createChildMessage('msg-3', 'msg-2', 'user', 'Message 3', 3000, 3000),
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
        createMessage('msg-1', 'user', 'Root 1', 1000, 1000),
        createMessage('msg-2', 'user', 'Root 2', 2000, 2000),
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
        createMessage('msg-1', 'user', 'Root', 1000, 1000),
        createChildMessage('msg-2', 'msg-1', 'assistant', 'Branch 1', 2000, 2000),
        createChildMessage('msg-3', 'msg-1', 'assistant', 'Branch 2', 3000, 3000),
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
        createMessage('msg-1', 'user', 'Root', 1000, 1000),
        createChildMessage('msg-2', 'msg-1', 'assistant', 'Branch 1', 2000, 2000),
        createChildMessage('msg-3', 'msg-2', 'user', 'Branch 1.1', 3000, 3000),
        createChildMessage('msg-4', 'msg-2', 'user', 'Branch 1.2', 4000, 4000),
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
        createMessage('msg-1', 'user', 'Level 0', 1000, 1000),
        createChildMessage('msg-2', 'msg-1', 'assistant', 'Level 1', 2000, 2000),
        createChildMessage('msg-3', 'msg-2', 'user', 'Level 2', 3000, 3000),
        createChildMessage('msg-4', 'msg-3', 'assistant', 'Level 3', 4000, 4000),
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
        createMessage('msg-1', 'user', 'Root', 1000, 1000),
        createChildMessage('msg-2', 'msg-1', 'assistant', 'Main flow', 2000, 2000),
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
        createMessage('msg-1', 'user', 'Main root', 1000, 1000),
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
        createMessage('msg-1', 'user', 'Root', 1000, 1000),
        createChildMessage('msg-2', 'msg-1', 'assistant', 'Main child', 2000, 2000),
        createChildMessage('msg-3', 'msg-2', 'user', 'Main grandchild', 3000, 3000),
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
      const messages: Message[] = [createMessage('msg-1', 'user', 'Lone message', 1000, 1000)];

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
        createChildMessage('msg-1', 'non-existent', 'user', 'Orphan', 1000, 1000),
      ];

      const helperMaps = buildHelperMaps(messages);
      const result = buildIdTree(helperMaps);

      // Orphan messages are promoted to roots by the indexing fallback
      expect(result).toEqual([
        {
          children: [],
          id: 'msg-1',
        },
      ]);
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
        createMessage('msg-1', 'user', 'Root', 1000, 1000),
        createChildMessage('msg-2', 'msg-1', 'assistant', 'Branch A', 2000, 2000),
        createChildMessage('msg-3', 'msg-2', 'user', 'Branch A -> Child', 3000, 3000),
        createChildMessage('msg-4', 'msg-1', 'assistant', 'Branch B', 4000, 4000),
        createChildMessage('msg-5', 'msg-4', 'user', 'Branch B -> Child 1', 5000, 5000),
        createChildMessage('msg-6', 'msg-4', 'user', 'Branch B -> Child 2', 6000, 6000),
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
        createMessage('msg-1', 'user', 'Tree 1 Root', 1000, 1000),
        createChildMessage('msg-2', 'msg-1', 'assistant', 'Tree 1 Child', 2000, 2000),
        // Tree 2
        createMessage('msg-3', 'user', 'Tree 2 Root', 3000, 3000),
        createChildMessage('msg-4', 'msg-3', 'assistant', 'Tree 2 Child', 4000, 4000),
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

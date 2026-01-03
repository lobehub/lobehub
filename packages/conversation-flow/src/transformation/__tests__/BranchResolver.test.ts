import { describe, expect, it } from 'vitest';

import type { IdNode, Message } from '../../types';
import { BranchResolver } from '../BranchResolver';

describe('BranchResolver', () => {
  const resolver = new BranchResolver();

  describe('getActiveBranchId', () => {
    it('should return branch by activeBranchIndex from metadata when present', () => {
      const message: Message = {
        content: 'test',
        createdAt: 0,
        id: 'msg-1',
        metadata: { activeBranchIndex: 1 },
        role: 'user',
        updatedAt: 0,
      };

      const idNode: IdNode = {
        children: [
          { children: [], id: 'msg-2' },
          { children: [], id: 'msg-3' },
        ],
        id: 'msg-1',
      };

      expect(resolver.getActiveBranchId(message, idNode)).toBe('msg-3');
    });

    it('should infer active branch from which branch has children', () => {
      const message: Message = {
        content: 'test',
        createdAt: 0,
        id: 'msg-1',
        role: 'user',
        updatedAt: 0,
      };

      const idNode: IdNode = {
        children: [
          { children: [], id: 'msg-2' },
          { children: [{ children: [], id: 'msg-4' }], id: 'msg-3' },
        ],
        id: 'msg-1',
      };

      expect(resolver.getActiveBranchId(message, idNode)).toBe('msg-3');
    });

    it('should default to first branch when no hints available', () => {
      const message: Message = {
        content: 'test',
        createdAt: 0,
        id: 'msg-1',
        role: 'user',
        updatedAt: 0,
      };

      const idNode: IdNode = {
        children: [
          { children: [], id: 'msg-2' },
          { children: [], id: 'msg-3' },
        ],
        id: 'msg-1',
      };

      expect(resolver.getActiveBranchId(message, idNode)).toBe('msg-2');
    });

    it('should return undefined for optimistic update (activeBranchIndex === children.length)', () => {
      const message: Message = {
        content: 'test',
        createdAt: 0,
        id: 'msg-1',
        metadata: { activeBranchIndex: 2 }, // index = children.length (optimistic update)
        role: 'user',
        updatedAt: 0,
      };

      const idNode: IdNode = {
        children: [
          { children: [], id: 'msg-2' },
          { children: [], id: 'msg-3' },
        ],
        id: 'msg-1',
      };

      // When activeBranchIndex === children.length, it's an optimistic update
      // The branch hasn't been created yet, so return undefined
      expect(resolver.getActiveBranchId(message, idNode)).toBeUndefined();
    });

    it('should ignore activeBranchIndex when it exceeds optimistic update range', () => {
      const message: Message = {
        content: 'test',
        createdAt: 0,
        id: 'msg-1',
        metadata: { activeBranchIndex: 5 }, // > children.length (invalid)
        role: 'user',
        updatedAt: 0,
      };

      const idNode: IdNode = {
        children: [
          { children: [], id: 'msg-2' },
          { children: [], id: 'msg-3' },
        ],
        id: 'msg-1',
      };

      // activeBranchIndex > children.length should be ignored, fallback to default
      expect(resolver.getActiveBranchId(message, idNode)).toBe('msg-2');
    });
  });

  describe('getActiveBranchIdFromMetadata', () => {
    it('should return branch by activeBranchIndex from metadata', () => {
      const message: Message = {
        content: 'test',
        createdAt: 0,
        id: 'msg-1',
        metadata: { activeBranchIndex: 1 },
        role: 'user',
        updatedAt: 0,
      };

      const childIds = ['msg-2', 'msg-3'];
      const childrenMap = new Map<string | null, string[]>();

      expect(resolver.getActiveBranchIdFromMetadata(message, childIds, childrenMap)).toBe('msg-3');
    });

    it('should infer active branch from which child has descendants', () => {
      const message: Message = {
        content: 'test',
        createdAt: 0,
        id: 'msg-1',
        role: 'user',
        updatedAt: 0,
      };

      const childIds = ['msg-2', 'msg-3'];
      const childrenMap = new Map<string | null, string[]>([
        ['msg-2', []],
        ['msg-3', ['msg-4']],
      ]);

      expect(resolver.getActiveBranchIdFromMetadata(message, childIds, childrenMap)).toBe('msg-3');
    });

    it('should default to first child when no hints available', () => {
      const message: Message = {
        content: 'test',
        createdAt: 0,
        id: 'msg-1',
        role: 'user',
        updatedAt: 0,
      };

      const childIds = ['msg-2', 'msg-3'];
      const childrenMap = new Map<string | null, string[]>();

      expect(resolver.getActiveBranchIdFromMetadata(message, childIds, childrenMap)).toBe('msg-2');
    });

    it('should return undefined for optimistic update (activeBranchIndex === childIds.length)', () => {
      const message: Message = {
        content: 'test',
        createdAt: 0,
        id: 'msg-1',
        metadata: { activeBranchIndex: 2 }, // index = childIds.length (optimistic update)
        role: 'user',
        updatedAt: 0,
      };

      const childIds = ['msg-2', 'msg-3'];
      const childrenMap = new Map<string | null, string[]>();

      // When activeBranchIndex === childIds.length, it's an optimistic update
      // The branch hasn't been created yet, so return undefined
      expect(
        resolver.getActiveBranchIdFromMetadata(message, childIds, childrenMap),
      ).toBeUndefined();
    });

    it('should ignore activeBranchIndex when it exceeds optimistic update range', () => {
      const message: Message = {
        content: 'test',
        createdAt: 0,
        id: 'msg-1',
        metadata: { activeBranchIndex: 5 }, // > childIds.length (invalid)
        role: 'user',
        updatedAt: 0,
      };

      const childIds = ['msg-2', 'msg-3'];
      const childrenMap = new Map<string | null, string[]>();

      // activeBranchIndex > childIds.length should be ignored, fallback to default
      expect(resolver.getActiveBranchIdFromMetadata(message, childIds, childrenMap)).toBe('msg-2');
    });
  });
});

import { describe, expect, it } from 'vitest';

import { merge, mergeArrayById } from './merge';

describe('merge', () => {
  describe('basic object merging', () => {
    it('should merge two simple objects', () => {
      const target = { a: 1, b: 2 };
      const source = { b: 3, c: 4 };

      const result = merge(target, source);

      expect(result).toEqual({ a: 1, b: 3, c: 4 });
    });

    it('should merge nested objects', () => {
      const target = { a: { x: 1, y: 2 }, b: 3 };
      const source = { a: { y: 4, z: 5 }, c: 6 };

      const result = merge(target, source);

      expect(result).toEqual({
        a: { x: 1, y: 4, z: 5 },
        b: 3,
        c: 6,
      });
    });

    it('should not mutate the original objects', () => {
      const target = { a: 1, b: 2 };
      const source = { b: 3, c: 4 };

      const targetClone = JSON.parse(JSON.stringify(target));
      const sourceClone = JSON.parse(JSON.stringify(source));

      merge(target, source);

      expect(target).toEqual(targetClone);
      expect(source).toEqual(sourceClone);
    });
  });

  describe('array handling', () => {
    it('should replace arrays instead of merging them', () => {
      const target = { items: [1, 2, 3] };
      const source = { items: [4, 5] };

      const result = merge(target, source);

      expect(result).toEqual({ items: [4, 5] });
    });

    it('should replace arrays in nested objects', () => {
      const target = {
        config: {
          values: [1, 2, 3],
          name: 'original',
        },
      };
      const source = {
        config: {
          values: [7, 8, 9],
        },
      };

      const result = merge(target, source);

      expect(result).toEqual({
        config: {
          values: [7, 8, 9],
          name: 'original',
        },
      });
    });

    it('should handle empty arrays', () => {
      const target = { items: [1, 2, 3] };
      const source = { items: [] };

      const result = merge(target, source);

      expect(result).toEqual({ items: [] });
    });

    it('should handle arrays with objects', () => {
      const target = { items: [{ id: 1, name: 'a' }] };
      const source = { items: [{ id: 2, name: 'b' }] };

      const result = merge(target, source);

      expect(result).toEqual({ items: [{ id: 2, name: 'b' }] });
    });
  });

  describe('edge cases', () => {
    it('should handle empty target', () => {
      const target = {};
      const source = { a: 1, b: 2 };

      const result = merge(target, source);

      expect(result).toEqual({ a: 1, b: 2 });
    });

    it('should handle empty source', () => {
      const target = { a: 1, b: 2 };
      const source = {};

      const result = merge(target, source);

      expect(result).toEqual({ a: 1, b: 2 });
    });

    it('should handle null values', () => {
      const target = { a: 1, b: 2 };
      const source = { b: null };

      const result = merge(target, source);

      expect(result).toEqual({ a: 1, b: null });
    });

    it('should handle undefined values by not overwriting', () => {
      const target = { a: 1, b: 2 };
      const source = { b: undefined, c: 3 };

      const result = merge(target, source);

      // lodash merge doesn't overwrite with undefined
      expect(result).toEqual({ a: 1, b: 2, c: 3 });
    });

    it('should handle deeply nested objects', () => {
      const target = {
        level1: {
          level2: {
            level3: {
              value: 'original',
            },
          },
        },
      };
      const source = {
        level1: {
          level2: {
            level3: {
              value: 'updated',
              newProp: 'added',
            },
          },
        },
      };

      const result = merge(target, source);

      expect(result).toEqual({
        level1: {
          level2: {
            level3: {
              value: 'updated',
              newProp: 'added',
            },
          },
        },
      });
    });
  });

  describe('mixed data types', () => {
    it('should handle boolean values', () => {
      const target = { enabled: true, active: false };
      const source = { enabled: false };

      const result = merge(target, source);

      expect(result).toEqual({ enabled: false, active: false });
    });

    it('should handle number values', () => {
      const target = { count: 10, limit: 100 };
      const source = { count: 20 };

      const result = merge(target, source);

      expect(result).toEqual({ count: 20, limit: 100 });
    });

    it('should handle string values', () => {
      const target = { name: 'original', description: 'test' };
      const source = { name: 'updated' };

      const result = merge(target, source);

      expect(result).toEqual({ name: 'updated', description: 'test' });
    });

    it('should handle mixed types in nested objects', () => {
      const target = {
        config: {
          enabled: true,
          count: 10,
          items: [1, 2],
          metadata: { key: 'value' },
        },
      };
      const source = {
        config: {
          enabled: false,
          items: [3, 4, 5],
          metadata: { key: 'updated', newKey: 'newValue' },
        },
      };

      const result = merge(target, source);

      expect(result).toEqual({
        config: {
          enabled: false,
          count: 10,
          items: [3, 4, 5],
          metadata: { key: 'updated', newKey: 'newValue' },
        },
      });
    });
  });
});

describe('mergeArrayById', () => {
  describe('basic merging', () => {
    it('should merge items by id and preserve default metadata', () => {
      const defaultItems = [
        {
          contextWindowTokens: 128_000,
          description: 'Test model description',
          displayName: 'Test Model',
          enabled: true,
          id: 'test-model',
          maxOutput: 65_536,
          pricing: {
            input: 3,
            output: 12,
          },
        },
      ];
      const userItems = [{ id: 'test-model', displayName: 'Custom Name', enabled: false }];

      const result = mergeArrayById(defaultItems, userItems);

      expect(result).toEqual([
        {
          contextWindowTokens: 128_000,
          description: 'Test model description',
          displayName: 'Custom Name',
          enabled: false,
          id: 'test-model',
          maxOutput: 65_536,
          pricing: {
            input: 3,
            output: 12,
          },
        },
      ]);
    });

    it('should override user values but preserve default metadata', () => {
      const defaultItems = [
        {
          id: 'model-1',
          name: 'Default Name',
          value: 100,
          metadata: { key: 'preserved' },
        },
      ];
      const userItems = [{ id: 'model-1', name: 'User Name', value: 200 }];

      const result = mergeArrayById(defaultItems, userItems);

      expect(result).toEqual([
        {
          id: 'model-1',
          name: 'User Name',
          value: 200,
          metadata: { key: 'preserved' },
        },
      ]);
    });
  });

  describe('empty array handling', () => {
    it('should return empty array when both inputs are empty', () => {
      const result = mergeArrayById([], []);
      expect(result).toEqual([]);
    });

    it('should return all default items when user items is empty', () => {
      const defaultItems = [
        { id: '1', name: 'Default 1', value: 100 },
        { id: '2', name: 'Default 2', value: 200 },
      ];

      const result = mergeArrayById(defaultItems, []);
      expect(result).toEqual(defaultItems);
    });

    it('should return all user items when default items is empty', () => {
      const userItems = [
        { id: '1', name: 'User 1', value: 300 },
        { id: '2', name: 'User 2', value: 400 },
      ];

      const result = mergeArrayById([], userItems);
      expect(result).toEqual(userItems);
    });
  });

  describe('ID matching scenarios', () => {
    it('should handle user items with IDs not in default items', () => {
      const defaultItems = [{ id: '1', name: 'Default 1', value: 100 }];
      const userItems = [
        { id: '1', name: 'User 1', value: 200 },
        { id: '2', name: 'User 2', value: 300 },
      ];

      const result = mergeArrayById(defaultItems, userItems);

      expect(result).toHaveLength(2);
      expect(result).toContainEqual({ id: '1', name: 'User 1', value: 200 });
      expect(result).toContainEqual({ id: '2', name: 'User 2', value: 300 });
    });

    it('should preserve default items not in user items', () => {
      const defaultItems = [
        { id: '1', name: 'Default 1', value: 100 },
        { id: '2', name: 'Default 2', value: 200 },
        { id: '3', name: 'Default 3', value: 300 },
      ];
      const userItems = [{ id: '2', name: 'User 2', value: 250 }];

      const result = mergeArrayById(defaultItems, userItems);

      expect(result).toHaveLength(3);
      expect(result).toContainEqual({ id: '1', name: 'Default 1', value: 100 });
      expect(result).toContainEqual({ id: '2', name: 'User 2', value: 250 });
      expect(result).toContainEqual({ id: '3', name: 'Default 3', value: 300 });
    });

    it('should merge multiple items correctly', () => {
      const defaultItems = [
        { id: '1', name: 'Default 1', value: 100, meta: { key: 'value1' } },
        { id: '2', name: 'Default 2', value: 200, meta: { key: 'value2' } },
      ];
      const userItems = [
        { id: '2', name: 'User 2', value: 300 },
        { id: '1', name: 'User 1', value: 400 },
      ];

      const result = mergeArrayById(defaultItems, userItems);

      expect(result).toHaveLength(2);
      expect(result).toContainEqual({
        id: '1',
        name: 'User 1',
        value: 400,
        meta: { key: 'value1' },
      });
      expect(result).toContainEqual({
        id: '2',
        name: 'User 2',
        value: 300,
        meta: { key: 'value2' },
      });
    });
  });

  describe('special value handling', () => {
    it('should handle null values by keeping default values', () => {
      const defaultItems = [{ id: '1', name: 'Default', value: 100, meta: { key: 'value' } }];
      const userItems = [{ id: '1', name: null, value: 200, meta: null }];

      const result = mergeArrayById(defaultItems, userItems as any);

      expect(result).toEqual([{ id: '1', name: 'Default', value: 200, meta: { key: 'value' } }]);
    });

    it('should handle undefined values by keeping default values', () => {
      const defaultItems = [{ id: '1', name: 'Default', value: 100, meta: { key: 'value' } }];
      const userItems = [{ id: '1', name: undefined, value: 200, meta: undefined }];

      const result = mergeArrayById(defaultItems, userItems as any);

      expect(result).toEqual([{ id: '1', name: 'Default', value: 200, meta: { key: 'value' } }]);
    });

    it('should handle empty objects by keeping default values', () => {
      const defaultItems = [
        {
          id: '1',
          name: 'Default',
          config: { key1: 'value1', key2: 'value2' },
        },
      ];
      const userItems = [{ id: '1', name: 'User', config: {} }];

      const result = mergeArrayById(defaultItems, userItems);

      expect(result).toEqual([
        {
          id: '1',
          name: 'User',
          config: { key1: 'value1', key2: 'value2' },
        },
      ]);
    });

    it('should merge nested objects correctly', () => {
      const defaultItems = [
        {
          id: '1',
          config: {
            deep: {
              value: 100,
              keep: true,
            },
            surface: 'default',
          },
        },
      ];
      const userItems = [
        {
          id: '1',
          config: {
            deep: {
              value: 200,
            },
            surface: 'changed',
          },
        },
      ];

      const result = mergeArrayById(defaultItems, userItems);

      expect(result[0].config).toEqual({
        deep: {
          value: 200,
          keep: true,
        },
        surface: 'changed',
      });
    });

    it('should handle deeply nested object merging', () => {
      const defaultItems = [
        {
          id: '1',
          abilities: {
            reasoning: true,
            functionCalling: true,
          },
          config: {
            deploymentName: 'default',
          },
        },
      ];
      const userItems = [
        {
          id: '1',
          abilities: {
            reasoning: false,
          },
          config: {
            deploymentName: 'custom',
          },
        },
      ];

      const result = mergeArrayById(defaultItems, userItems);

      expect(result).toEqual([
        {
          id: '1',
          abilities: {
            functionCalling: true,
            reasoning: false,
          },
          config: {
            deploymentName: 'custom',
          },
        },
      ]);
    });
  });

  describe('edge cases', () => {
    it('should preserve the source objects (no mutation)', () => {
      const defaultItems = [{ id: '1', name: 'Default', meta: { key: 'value' } }];
      const userItems = [{ id: '1', name: 'User' }];

      const defaultItemsClone = JSON.parse(JSON.stringify(defaultItems));
      const userItemsClone = JSON.parse(JSON.stringify(userItems));

      mergeArrayById(defaultItems, userItems);

      expect(defaultItems).toEqual(defaultItemsClone);
      expect(userItems).toEqual(userItemsClone);
    });

    it('should handle duplicate IDs in user items by using the last occurrence', () => {
      const defaultItems = [{ id: '1', name: 'Default', value: 100 }];
      const userItems = [
        { id: '1', name: 'User 1', value: 200 },
        { id: '1', name: 'User 2', value: 300 },
      ];

      const result = mergeArrayById(defaultItems, userItems);

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({
        id: '1',
        name: 'User 2',
        value: 300,
      });
    });

    it('should handle duplicate IDs in default items by using the last occurrence', () => {
      const defaultItems = [
        { id: '1', name: 'Default 1', value: 100, meta: 'first' },
        { id: '1', name: 'Default 2', value: 200, meta: 'second' },
      ];
      const userItems = [{ id: '1', name: 'User' }];

      const result = mergeArrayById(defaultItems, userItems);

      // Map uses last occurrence when there are duplicates
      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({
        id: '1',
        name: 'User',
        value: 200,
        meta: 'second',
      });
    });

    it('should handle complex real-world scenario', () => {
      const defaultItems = [
        {
          contextWindowTokens: 200_000,
          description: 'Advanced reasoning model',
          displayName: 'Model O1',
          enabled: true,
          id: 'o1',
          abilities: {
            reasoning: true,
            functionCalling: true,
          },
          config: {
            deploymentName: 'o1',
          },
          maxOutput: 100_000,
          pricing: {
            input: 15,
            output: 60,
          },
          source: 'builtin',
        },
      ];
      const userItems = [
        {
          id: 'o1',
          abilities: {
            reasoning: false,
          },
          config: {
            deploymentName: 'custom-o1',
          },
          displayName: 'Custom O1',
          enabled: false,
        },
      ];

      const result = mergeArrayById(defaultItems, userItems);

      expect(result).toEqual([
        {
          contextWindowTokens: 200_000,
          description: 'Advanced reasoning model',
          displayName: 'Custom O1',
          enabled: false,
          id: 'o1',
          abilities: {
            functionCalling: true,
            reasoning: false,
          },
          config: {
            deploymentName: 'custom-o1',
          },
          maxOutput: 100_000,
          pricing: {
            input: 15,
            output: 60,
          },
          source: 'builtin',
        },
      ]);
    });

    it('should handle items with only id property', () => {
      const defaultItems = [{ id: '1', name: 'Default', value: 100 }];
      const userItems = [{ id: '1' }];

      const result = mergeArrayById(defaultItems, userItems);

      expect(result).toEqual([{ id: '1', name: 'Default', value: 100 }]);
    });

    it('should handle mixed scenario with new, updated, and unchanged items', () => {
      const defaultItems = [
        { id: '1', name: 'Default 1', value: 100 },
        { id: '2', name: 'Default 2', value: 200 },
        { id: '3', name: 'Default 3', value: 300 },
      ];
      const userItems = [
        { id: '2', name: 'Updated 2', value: 250 },
        { id: '4', name: 'New 4', value: 400 },
      ];

      const result = mergeArrayById(defaultItems, userItems);

      expect(result).toHaveLength(4);
      expect(result).toContainEqual({ id: '1', name: 'Default 1', value: 100 });
      expect(result).toContainEqual({ id: '2', name: 'Updated 2', value: 250 });
      expect(result).toContainEqual({ id: '3', name: 'Default 3', value: 300 });
      expect(result).toContainEqual({ id: '4', name: 'New 4', value: 400 });
    });
  });

  describe('primitive value handling in arrays', () => {
    it('should handle simple property replacement', () => {
      const defaultItems = [
        {
          id: '1',
          name: 'Default',
          count: 10,
        },
      ];
      const userItems = [
        {
          id: '1',
          count: 20,
        },
      ];

      const result = mergeArrayById(defaultItems, userItems);

      expect(result[0].count).toBe(20);
      expect((result[0] as any).name).toBe('Default');
    });

    it('should handle string values correctly', () => {
      const defaultItems = [
        {
          id: '1',
          title: 'Default Title',
          description: 'Default Description',
        },
      ];
      const userItems = [
        {
          id: '1',
          title: 'Custom Title',
        },
      ];

      const result = mergeArrayById(defaultItems, userItems);

      expect(result[0].title).toBe('Custom Title');
      expect((result[0] as any).description).toBe('Default Description');
    });
  });
});

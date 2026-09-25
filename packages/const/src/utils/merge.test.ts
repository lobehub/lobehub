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
  });

  describe('edge cases', () => {
    it('should handle undefined values by not overwriting', () => {
      const target = { a: 1, b: 2 };
      const source = { b: undefined, c: 3 };

      const result = merge(target, source);

      // lodash merge doesn't overwrite with undefined
      expect(result).toEqual({ a: 1, b: 2, c: 3 });
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
  });
});

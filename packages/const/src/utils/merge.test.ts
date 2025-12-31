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
      const target = { a: 1, nested: { x: 1, y: 2 } };
      const source = { nested: { y: 3, z: 4 } };

      const result = merge(target, source);

      expect(result).toEqual({
        a: 1,
        nested: { x: 1, y: 3, z: 4 },
      });
    });

    it('should not mutate the original target object', () => {
      const target = { a: 1, b: 2 };
      const source = { b: 3, c: 4 };

      merge(target, source);

      expect(target).toEqual({ a: 1, b: 2 });
    });

    it('should not mutate the original source object', () => {
      const target = { a: 1, b: 2 };
      const source = { b: 3, c: 4 };

      merge(target, source);

      expect(source).toEqual({ b: 3, c: 4 });
    });
  });

  describe('array replacement behavior', () => {
    it('should replace arrays instead of merging them', () => {
      const target = { items: [1, 2, 3] };
      const source = { items: [4, 5] };

      const result = merge(target, source);

      expect(result).toEqual({ items: [4, 5] });
    });

    it('should replace arrays in nested objects', () => {
      const target = { data: { items: [1, 2, 3] } };
      const source = { data: { items: [4, 5] } };

      const result = merge(target, source);

      expect(result).toEqual({ data: { items: [4, 5] } });
    });

    it('should replace array with empty array', () => {
      const target = { items: [1, 2, 3] };
      const source = { items: [] };

      const result = merge(target, source);

      expect(result).toEqual({ items: [] });
    });
  });

  describe('edge cases', () => {
    it('should handle empty target object', () => {
      const target = {};
      const source = { a: 1, b: 2 };

      const result = merge(target, source);

      expect(result).toEqual({ a: 1, b: 2 });
    });

    it('should handle empty source object', () => {
      const target = { a: 1, b: 2 };
      const source = {};

      const result = merge(target, source);

      expect(result).toEqual({ a: 1, b: 2 });
    });

    it('should handle both empty objects', () => {
      const target = {};
      const source = {};

      const result = merge(target, source);

      expect(result).toEqual({});
    });

    it('should handle null values in source', () => {
      const target = { a: 1, b: 2 };
      const source = { a: null, c: 3 };

      const result = merge(target, source);

      expect(result).toEqual({ a: null, b: 2, c: 3 });
    });

    it('should handle undefined values in source', () => {
      const target = { a: 1, b: 2 };
      const source = { a: undefined, c: 3 };

      const result = merge(target, source);

      // lodash merge does not preserve undefined values
      expect(result).toEqual({ a: 1, b: 2, c: 3 });
    });
  });
});

describe('mergeArrayById', () => {
  describe('basic merging', () => {
    it('should merge user items with default items by id', () => {
      const defaultItems = [
        { id: '1', name: 'Item 1', meta: 'default1' },
        { id: '2', name: 'Item 2', meta: 'default2' },
      ];
      const userItems = [{ id: '1', name: 'Custom Item 1' }];

      const result = mergeArrayById(defaultItems, userItems);

      expect(result).toEqual([
        { id: '1', name: 'Custom Item 1', meta: 'default1' },
        { id: '2', name: 'Item 2', meta: 'default2' },
      ]);
    });

    it('should preserve all user item properties when no default exists', () => {
      const defaultItems = [{ id: '1', name: 'Item 1', meta: 'default1' }];
      const userItems = [{ id: '2', name: 'User Item 2', custom: 'property' }];

      const result = mergeArrayById(defaultItems, userItems);

      expect(result).toContainEqual({ id: '2', name: 'User Item 2', custom: 'property' });
    });

    it('should include default items that are not in user items', () => {
      const defaultItems = [
        { id: '1', name: 'Item 1', meta: 'default1' },
        { id: '2', name: 'Item 2', meta: 'default2' },
        { id: '3', name: 'Item 3', meta: 'default3' },
      ];
      const userItems = [{ id: '1', name: 'Custom Item 1' }];

      const result = mergeArrayById(defaultItems, userItems);

      expect(result).toHaveLength(3);
      expect(result).toContainEqual({ id: '2', name: 'Item 2', meta: 'default2' });
      expect(result).toContainEqual({ id: '3', name: 'Item 3', meta: 'default3' });
    });
  });

  describe('value filtering', () => {
    it('should filter out null values from user items', () => {
      const defaultItems = [{ id: '1', name: 'Item 1', meta: 'default1' }];
      const userItems = [{ id: '1', name: null, custom: 'value' }];

      const result = mergeArrayById(defaultItems, userItems);

      expect(result[0]).toEqual({ id: '1', name: 'Item 1', meta: 'default1', custom: 'value' });
    });

    it('should filter out undefined values from user items', () => {
      const defaultItems = [{ id: '1', name: 'Item 1', meta: 'default1' }];
      const userItems = [{ id: '1', name: undefined, custom: 'value' }];

      const result = mergeArrayById(defaultItems, userItems);

      expect(result[0]).toEqual({ id: '1', name: 'Item 1', meta: 'default1', custom: 'value' });
    });

    it('should filter out empty objects from user items', () => {
      const defaultItems = [{ id: '1', name: 'Item 1', config: { key: 'value' } }];
      const userItems = [{ id: '1', config: {} }];

      const result = mergeArrayById(defaultItems, userItems);

      expect(result[0]).toEqual({ id: '1', name: 'Item 1', config: { key: 'value' } });
    });

    it('should not filter out falsy values like 0 or false', () => {
      const defaultItems = [{ id: '1', count: 10, enabled: true }];
      const userItems = [{ id: '1', count: 0, enabled: false }];

      const result = mergeArrayById(defaultItems, userItems);

      expect(result[0]).toEqual({ id: '1', count: 0, enabled: false });
    });

    it('should not filter out empty strings', () => {
      const defaultItems = [{ id: '1', name: 'Item 1', description: 'default' }];
      const userItems = [{ id: '1', description: '' }];

      const result = mergeArrayById(defaultItems, userItems);

      expect(result[0]).toEqual({ id: '1', name: 'Item 1', description: '' });
    });
  });

  describe('nested object merging', () => {
    it('should merge nested objects using merge function', () => {
      const defaultItems = [
        {
          id: '1',
          name: 'Item 1',
          config: { x: 1, y: 2, z: 3 },
        },
      ];
      const userItems = [
        {
          id: '1',
          config: { y: 20, w: 4 },
        },
      ];

      const result = mergeArrayById(defaultItems, userItems);

      expect(result[0]).toEqual({
        id: '1',
        name: 'Item 1',
        config: { x: 1, y: 20, z: 3, w: 4 },
      });
    });

    it('should replace arrays in nested objects', () => {
      const defaultItems = [
        {
          id: '1',
          name: 'Item 1',
          config: { items: [1, 2, 3] },
        },
      ];
      const userItems = [
        {
          id: '1',
          config: { items: [4, 5] },
        },
      ];

      const result = mergeArrayById(defaultItems, userItems);

      expect(result[0]).toEqual({
        id: '1',
        name: 'Item 1',
        config: { items: [4, 5] },
      });
    });

    it('should handle deeply nested objects', () => {
      const defaultItems = [
        {
          id: '1',
          config: { level1: { level2: { value: 'default' } } },
        },
      ];
      const userItems = [
        {
          id: '1',
          config: { level1: { level2: { value: 'custom', extra: 'data' } } },
        },
      ];

      const result = mergeArrayById(defaultItems, userItems);

      expect(result[0]).toEqual({
        id: '1',
        config: { level1: { level2: { value: 'custom', extra: 'data' } } },
      });
    });
  });

  describe('duplicate handling', () => {
    it('should handle duplicate IDs in user items (last one wins)', () => {
      const defaultItems = [{ id: '1', name: 'Item 1', meta: 'default' }];
      const userItems = [
        { id: '1', name: 'First' },
        { id: '1', name: 'Second' },
        { id: '1', name: 'Third' },
      ];

      const result = mergeArrayById(defaultItems, userItems);

      expect(result).toHaveLength(1);
      expect(result[0].name).toBe('Third');
    });

    it('should preserve metadata when handling duplicates', () => {
      const defaultItems = [{ id: '1', name: 'Item 1', meta: 'default' }];
      const userItems = [
        { id: '1', custom1: 'value1' },
        { id: '1', custom2: 'value2' },
      ];

      const result = mergeArrayById(defaultItems, userItems);

      expect(result[0]).toEqual({
        id: '1',
        name: 'Item 1',
        meta: 'default',
        custom2: 'value2',
      });
    });
  });

  describe('edge cases', () => {
    it('should handle empty default items array', () => {
      const defaultItems: Array<{ id: string; name: string }> = [];
      const userItems = [{ id: '1', name: 'User Item 1' }];

      const result = mergeArrayById(defaultItems, userItems);

      expect(result).toEqual([{ id: '1', name: 'User Item 1' }]);
    });

    it('should handle empty user items array', () => {
      const defaultItems = [
        { id: '1', name: 'Item 1' },
        { id: '2', name: 'Item 2' },
      ];
      const userItems: Array<{ id: string; name: string }> = [];

      const result = mergeArrayById(defaultItems, userItems);

      expect(result).toEqual(defaultItems);
    });

    it('should handle both empty arrays', () => {
      const defaultItems: Array<{ id: string }> = [];
      const userItems: Array<{ id: string }> = [];

      const result = mergeArrayById(defaultItems, userItems);

      expect(result).toEqual([]);
    });

    it('should handle items with only id property', () => {
      const defaultItems = [{ id: '1' }];
      const userItems = [{ id: '1' }];

      const result = mergeArrayById(defaultItems, userItems);

      expect(result).toEqual([{ id: '1' }]);
    });

    it('should handle complex objects with mixed types', () => {
      const defaultItems = [
        {
          id: '1',
          string: 'default',
          number: 42,
          boolean: true,
          nested: { key: 'value' },
        },
      ];
      const userItems = [
        {
          id: '1',
          number: 100,
          boolean: false,
        },
      ];

      const result = mergeArrayById(defaultItems, userItems);

      expect(result[0]).toEqual({
        id: '1',
        string: 'default',
        number: 100,
        boolean: false,
        nested: { key: 'value' },
      });
    });
  });

  describe('order preservation', () => {
    it('should maintain user items order followed by remaining default items', () => {
      const defaultItems = [
        { id: '1', name: 'Item 1' },
        { id: '2', name: 'Item 2' },
        { id: '3', name: 'Item 3' },
      ];
      const userItems = [
        { id: '3', name: 'Custom 3' },
        { id: '1', name: 'Custom 1' },
      ];

      const result = mergeArrayById(defaultItems, userItems);

      expect(result.map((item) => item.id)).toEqual(['3', '1', '2']);
    });
  });
});

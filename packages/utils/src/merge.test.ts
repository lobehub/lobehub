import { describe, expect, it } from 'vitest';

import { mergeArrayById } from './merge';

describe('mergeArrayById', () => {
  it('should merge data', () => {
    const data = mergeArrayById(
      [
        {
          contextWindowTokens: 128_000,
          description:
            'o1-mini是一款针对编程、数学和科学应用场景而设计的快速、经济高效的推理模型。该模型具有128K上下文和2023年10月的知识截止日期。',
          displayName: 'OpenAI o1-mini',
          enabled: true,
          id: 'o1-mini',
          maxOutput: 65_536,
          pricing: {
            input: 3,
            output: 12,
          },
          releasedAt: '2024-09-12',
          type: 'chat',
        },
      ],
      [{ id: 'o1-mini', displayName: 'OpenAI o1-mini ABC', type: 'chat' }],
    );

    expect(data).toEqual([
      {
        contextWindowTokens: 128_000,
        description:
          'o1-mini是一款针对编程、数学和科学应用场景而设计的快速、经济高效的推理模型。该模型具有128K上下文和2023年10月的知识截止日期。',
        displayName: 'OpenAI o1-mini ABC',
        enabled: true,
        id: 'o1-mini',
        maxOutput: 65_536,
        pricing: {
          input: 3,
          output: 12,
        },
        releasedAt: '2024-09-12',
        type: 'chat',
      },
    ]);
  });

  it('should merge data with objects', () => {
    const data = mergeArrayById(
      [
        {
          contextWindowTokens: 128_000,
          description:
            'o1-mini是一款针对编程、数学和科学应用场景而设计的快速、经济高效的推理模型。该模型具有128K上下文和2023年10月的知识截止日期。',
          displayName: 'OpenAI o1-mini',
          enabled: true,
          id: 'o3-mini',
          abilities: {
            functionCall: true,
          },
          maxOutput: 65_536,
          pricing: {
            input: 3,
            output: 12,
          },
          releasedAt: '2024-09-12',
          type: 'chat',
        },
      ],
      [
        {
          id: 'o3-mini',
          contextWindowTokens: null,
          displayName: 'OpenAI o1-mini ABC',
          type: 'chat',
          abilities: {},
          enabled: false,
        },
      ],
    );

    expect(data).toEqual([
      {
        contextWindowTokens: 128_000,
        description:
          'o1-mini是一款针对编程、数学和科学应用场景而设计的快速、经济高效的推理模型。该模型具有128K上下文和2023年10月的知识截止日期。',
        displayName: 'OpenAI o1-mini ABC',
        enabled: false,
        id: 'o3-mini',
        maxOutput: 65_536,
        pricing: {
          input: 3,
          output: 12,
        },
        abilities: {
          functionCall: true,
        },
        releasedAt: '2024-09-12',
        type: 'chat',
      },
    ]);
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
        { id: '2', name: 'User 2', value: 300 }, // New ID
      ];

      const result = mergeArrayById(defaultItems, userItems);
      expect(result).toHaveLength(2);
      expect(result).toContainEqual({ id: '1', name: 'User 1', value: 200 });
      expect(result).toContainEqual({ id: '2', name: 'User 2', value: 300 });
    });

    it('should merge multiple items correctly', () => {
      const defaultItems = [
        { id: '1', name: 'Default 1', value: 100, meta: { key: 'value' } },
        { id: '2', name: 'Default 2', value: 200, meta: { key: 'value' } },
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
        meta: { key: 'value' },
      });
      expect(result).toContainEqual({
        id: '2',
        name: 'User 2',
        value: 300,
        meta: { key: 'value' },
      });
    });
  });

  describe('special value handling', () => {
    it('should handle undefined values by keeping default values', () => {
      const defaultItems = [{ id: '1', name: 'Default', value: 100, meta: { key: 'value' } }];

      const userItems = [{ id: '1', name: undefined, value: 200, meta: undefined }];

      const result = mergeArrayById(defaultItems, userItems as any);

      expect(result).toEqual([{ id: '1', name: 'Default', value: 200, meta: { key: 'value' } }]);
    });

    it('should handle nested objects correctly', () => {
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
    it('should handle objects missing id property', () => {
      const defaultItems = [{ id: '1', name: 'Default' }];

      const userItems = [{ name: 'Invalid' }];

      expect(mergeArrayById(defaultItems, userItems as any)).toEqual([
        { name: 'Invalid' },
        { id: '1', name: 'Default' },
      ]);
    });

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
        { id: '1', name: 'User 2', value: 300 }, // Duplicate ID
      ];

      const result = mergeArrayById(defaultItems, userItems);

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({
        id: '1',
        name: 'User 2',
        value: 300,
      });
    });
  });

  it('should merge data with not empty objects', () => {
    const data = mergeArrayById(
      [
        {
          abilities: {
            reasoning: true,
            functionCalling: true,
          },
          config: {
            deploymentName: 'o1',
          },
          contextWindowTokens: 200000,
          description:
            'o1是OpenAI新的推理模型，支持图文输入并输出文本，适用于需要广泛通用知识的复杂任务。该模型具有200K上下文和2023年10月的知识截止日期。',
          displayName: 'OpenAI o1',
          enabled: true,
          id: 'o1',
          maxOutput: 100000,
          pricing: {
            input: 15,
            output: 60,
          },
          releasedAt: '2024-12-17',
          type: 'chat',
          source: 'builtin',
        },
      ],
      [
        {
          abilities: {
            reasoning: true,
          },
          config: {
            deploymentName: 'ddd',
          },
          contextWindowTokens: 200000,
          description:
            'o1是OpenAI新的推理模型，支持图文输入并输出文本，适用于需要广泛通用知识的复杂任务。该模型具有200K上下文和2023年10月的知识截止日期。',
          displayName: 'OpenAI o1',
          enabled: true,
          id: 'o1',
          maxOutput: 100000,
          releasedAt: '2024-12-17',
          type: 'chat',
        },
      ],
    );

    expect(data).toEqual([
      {
        abilities: {
          functionCalling: true,
          reasoning: true,
        },
        config: {
          deploymentName: 'ddd',
        },
        contextWindowTokens: 200000,
        description:
          'o1是OpenAI新的推理模型，支持图文输入并输出文本，适用于需要广泛通用知识的复杂任务。该模型具有200K上下文和2023年10月的知识截止日期。',
        displayName: 'OpenAI o1',
        enabled: true,
        id: 'o1',
        pricing: {
          input: 15,
          output: 60,
        },
        source: 'builtin',
        maxOutput: 100000,
        releasedAt: '2024-12-17',
        type: 'chat',
      },
    ]);
  });
});

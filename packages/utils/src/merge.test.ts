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

    it('should keep default order when overriding items', () => {
      const defaultItems = [
        { id: 'a', name: 'Default A' },
        { id: 'b', name: 'Default B' },
        { id: 'c', name: 'Default C' },
      ];

      const userItems = [
        { id: 'b', enabled: false, name: 'Default B' },
        { id: 'c', enabled: true, name: 'Default C' },
      ];

      const result = mergeArrayById(defaultItems, userItems);

      expect(result.map((item) => item.id)).toEqual(['a', 'b', 'c']);
      expect(result[1]).toMatchObject({ id: 'b', enabled: false });
      expect(result[2]).toMatchObject({ id: 'c', enabled: true });
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

  describe('ordering with sort field', () => {
    const idList = (items: Array<{ id?: string }>) => items.map((item) => item.id);

    it('prioritizes user-defined ordering for default items', () => {
      const defaultItems = [
        { id: 'openai', order: 0, meta: { provider: 'openai', tags: ['official'] } },
        { id: 'anthropic', order: 1 },
        { id: 'google', order: 2 },
      ] as Array<Record<string, any>>;
      const userItems = [
        { id: 'google', order: 2, sort: 0 },
        { id: 'openai', meta: { description: 'customized' }, order: 0, sort: 1 },
        // anthropic 不在 userItems 中，应该根据 modelbank 顺序智能插入
      ] as Array<Record<string, any>>;

      const result = mergeArrayById(defaultItems, userItems);

      // anthropic(defaultIndex=1) 向后找到 google(defaultIndex=2, sort=0)
      // google 在 sortedItems 的 index 是 0
      // anthropic 应该插入到 sortedItems[0] 的位置，即 google 前面
      // 最终顺序：anthropic(插入), google(sort=0), openai(sort=1)
      expect(idList(result)).toEqual(['anthropic', 'google', 'openai']);
      expect(result[2].meta).toEqual({
        provider: 'openai',
        tags: ['official'],
        description: 'customized',
      });
    });

    it('keeps model bank ordering when custom sort is not provided', () => {
      const defaultItems = [{ id: 'alpha' }, { id: 'beta' }, { id: 'gamma' }] as Array<
        Record<string, any>
      >;
      const userItems = [{ id: 'beta', enabled: true }] as Array<Record<string, any>>;

      const result = mergeArrayById(defaultItems, userItems);

      expect(idList(result)).toEqual(['alpha', 'beta', 'gamma']);
    });

    it('inserts newly enabled model in correct position based on model bank order', () => {
      const defaultItems = [
        { id: 'alpha' },
        { id: 'beta' },
        { id: 'gamma' },
        { id: 'delta' },
      ] as Array<Record<string, any>>;
      const userItems = [
        { id: 'alpha', sort: 0 },
        { id: 'delta', sort: 1 },
        // beta 和 gamma 未在 userItems 中，是新启用的
      ] as Array<Record<string, any>>;

      const result = mergeArrayById(defaultItems, userItems);

      // beta 应该插在 alpha 和 delta 之间（因为 beta 在默认列表中位于 alpha 后）
      // gamma 应该插在 delta 后（因为 gamma 在默认列表中位于 delta 前，但最近的已排序邻居是 delta）
      expect(idList(result)).toEqual(['alpha', 'beta', 'gamma', 'delta']);
    });

    it('places custom models at the end when no sort is provided', () => {
      const defaultItems = [
        { id: 'openai', order: 0 },
        { id: 'anthropic', order: 1 },
      ] as Array<Record<string, any>>;
      const userItems = [
        { id: 'custom-model', order: 99 },
        // 没有 sort 字段，说明没有自定义排序
      ] as Array<Record<string, any>>;

      const result = mergeArrayById(defaultItems, userItems);

      // 没有自定义排序时，先按 defaultItems 顺序，然后是自定义模型
      expect(idList(result)).toEqual(['openai', 'anthropic', 'custom-model']);
    });

    it('comprehensive test: custom sort with newly enabled models', () => {
      // 模拟实际场景：用户自定义排序后，又启用了新模型
      const defaultItems = [
        { id: 'gpt-4' }, // 0
        { id: 'gpt-3.5' }, // 1
        { id: 'claude-3' }, // 2
        { id: 'claude-2' }, // 3
        { id: 'gemini-pro' }, // 4
      ] as Array<Record<string, any>>;

      const userItems = [
        { id: 'claude-3', sort: 0 }, // 用户把 claude-3 放第一
        { id: 'gpt-4', sort: 1 }, // gpt-4 放第二
        { id: 'gemini-pro', sort: 2 }, // gemini-pro 放第三
        // gpt-3.5 和 claude-2 是新启用的，应该智能插入
      ] as Array<Record<string, any>>;

      const result = mergeArrayById(defaultItems, userItems);

      // gpt-3.5 (defaultIndex=1): 向后找到 claude-3 (defaultIndex=2, sort=0)
      //   claude-3 在 sortedItems 的 index 是 0，所以 gpt-3.5 插到 index=0
      // claude-2 (defaultIndex=3): 向后找到 gemini-pro (defaultIndex=4, sort=2)
      //   gemini-pro 在 sortedItems 的 index 是 2，所以 claude-2 插到 index=2
      // 最终：gpt-3.5, claude-3(sort=0), gpt-4(sort=1), claude-2, gemini-pro(sort=2)
      expect(idList(result)).toEqual(['gpt-3.5', 'claude-3', 'gpt-4', 'claude-2', 'gemini-pro']);
    });
  });
});

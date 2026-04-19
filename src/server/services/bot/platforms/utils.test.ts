import { describe, expect, it } from 'vitest';

import {
  buildRuntimeKey,
  extractDefaults,
  formatDuration,
  formatTokens,
  formatUsageStats,
  mergeWithDefaults,
  parseRuntimeKey,
} from './utils';

describe('formatTokens', () => {
  it('should return raw number for < 1000', () => {
    expect(formatTokens(0)).toBe('0');
    expect(formatTokens(999)).toBe('999');
  });

  it('should format thousands as k', () => {
    expect(formatTokens(1000)).toBe('1.0k');
    expect(formatTokens(1234)).toBe('1.2k');
    expect(formatTokens(20_400)).toBe('20.4k');
  });

  it('should format millions as m', () => {
    expect(formatTokens(1_000_000)).toBe('1.0m');
    expect(formatTokens(1_234_567)).toBe('1.2m');
  });
});

describe('formatDuration', () => {
  it('should format seconds', () => {
    expect(formatDuration(5000)).toBe('5s');
    expect(formatDuration(0)).toBe('0s');
  });

  it('should format minutes and seconds', () => {
    expect(formatDuration(65_000)).toBe('1m5s');
    expect(formatDuration(120_000)).toBe('2m0s');
  });
});

describe('formatUsageStats', () => {
  it('should format basic stats', () => {
    expect(formatUsageStats({ totalCost: 0.0312, totalTokens: 1234 })).toBe(
      '1.2k tokens · $0.0312',
    );
  });

  it('should include duration when provided', () => {
    expect(formatUsageStats({ elapsedMs: 3000, totalCost: 0.01, totalTokens: 500 })).toBe(
      '500 tokens · $0.0100 · 3s',
    );
  });

  it('should include call counts when llmCalls > 1', () => {
    expect(
      formatUsageStats({ llmCalls: 3, toolCalls: 2, totalCost: 0.05, totalTokens: 2000 }),
    ).toBe('2.0k tokens · $0.0500 | llm×3 | tools×2');
  });

  it('should include call counts when toolCalls > 0', () => {
    expect(formatUsageStats({ llmCalls: 1, toolCalls: 5, totalCost: 0.01, totalTokens: 800 })).toBe(
      '800 tokens · $0.0100 | llm×1 | tools×5',
    );
  });

  it('should hide call counts when llmCalls=1 and toolCalls=0', () => {
    expect(
      formatUsageStats({ llmCalls: 1, toolCalls: 0, totalCost: 0.001, totalTokens: 100 }),
    ).toBe('100 tokens · $0.0010');
  });
});

// ==================== extractDefaults ====================

describe('extractDefaults', () => {
  it('should return empty object for undefined input', () => {
    expect(extractDefaults(undefined)).toEqual({});
  });

  it('should return empty object for empty array', () => {
    expect(extractDefaults([])).toEqual({});
  });

  it('should extract simple default values', () => {
    expect(
      extractDefaults([
        { default: 'en', key: 'language', label: 'Language', type: 'string' },
        { default: 100, key: 'limit', label: 'Limit', type: 'number' },
        { default: true, key: 'enabled', label: 'Enabled', type: 'boolean' },
      ]),
    ).toEqual({ enabled: true, language: 'en', limit: 100 });
  });

  it('should skip fields without default values', () => {
    expect(
      extractDefaults([
        { key: 'noDefault', label: 'No Default', type: 'string' },
        { default: 'hello', key: 'withDefault', label: 'With Default', type: 'string' },
      ]),
    ).toEqual({ withDefault: 'hello' });
  });

  it('should recursively extract defaults from nested object fields', () => {
    expect(
      extractDefaults([
        {
          key: 'config',
          label: 'Config',
          properties: [
            { default: 'dark', key: 'theme', label: 'Theme', type: 'string' },
            { default: 10, key: 'size', label: 'Size', type: 'number' },
          ],
          type: 'object',
        },
      ]),
    ).toEqual({ config: { size: 10, theme: 'dark' } });
  });

  it('should omit nested object when no child has defaults', () => {
    expect(
      extractDefaults([
        {
          key: 'config',
          label: 'Config',
          properties: [{ key: 'theme', label: 'Theme', type: 'string' }],
          type: 'object',
        },
      ]),
    ).toEqual({});
  });

  it('should handle deeply nested object fields', () => {
    expect(
      extractDefaults([
        {
          key: 'outer',
          label: 'Outer',
          properties: [
            {
              key: 'inner',
              label: 'Inner',
              properties: [{ default: 42, key: 'value', label: 'Value', type: 'integer' }],
              type: 'object',
            },
          ],
          type: 'object',
        },
      ]),
    ).toEqual({ outer: { inner: { value: 42 } } });
  });
});

// ==================== mergeWithDefaults ====================

describe('mergeWithDefaults', () => {
  const schema = [
    {
      key: 'settings',
      label: 'Settings',
      properties: [
        { default: 'en', key: 'language', label: 'Language', type: 'string' as const },
        { default: 100, key: 'limit', label: 'Limit', type: 'number' as const },
      ],
      type: 'object' as const,
    },
  ];

  it('should return schema defaults when no user settings provided', () => {
    expect(mergeWithDefaults(schema)).toEqual({ language: 'en', limit: 100 });
  });

  it('should return schema defaults when user settings is null', () => {
    expect(mergeWithDefaults(schema, null)).toEqual({ language: 'en', limit: 100 });
  });

  it('should override defaults with user settings', () => {
    expect(mergeWithDefaults(schema, { language: 'zh', limit: 50 })).toEqual({
      language: 'zh',
      limit: 50,
    });
  });

  it('should deep-merge user settings over defaults', () => {
    expect(mergeWithDefaults(schema, { language: 'fr' })).toEqual({
      language: 'fr',
      limit: 100,
    });
  });

  it('should return empty object when schema has no settings field', () => {
    const schemaNoSettings = [
      { key: 'credentials', label: 'Credentials', type: 'object' as const },
    ];
    expect(mergeWithDefaults(schemaNoSettings, { extra: 'value' })).toEqual({ extra: 'value' });
  });

  it('should return user settings when schema has no settings defaults', () => {
    const emptySchema: never[] = [];
    expect(mergeWithDefaults(emptySchema, { custom: 'value' })).toEqual({ custom: 'value' });
  });
});

// ==================== buildRuntimeKey ====================

describe('buildRuntimeKey', () => {
  it('should combine platform and applicationId with colon separator', () => {
    expect(buildRuntimeKey('discord', 'app123')).toBe('discord:app123');
  });

  it('should handle platform with special characters', () => {
    expect(buildRuntimeKey('slack-bot', 'my-app-id')).toBe('slack-bot:my-app-id');
  });

  it('should handle empty applicationId', () => {
    expect(buildRuntimeKey('telegram', '')).toBe('telegram:');
  });

  it('should handle empty platform', () => {
    expect(buildRuntimeKey('', 'app456')).toBe(':app456');
  });
});

// ==================== parseRuntimeKey ====================

describe('parseRuntimeKey', () => {
  it('should parse a valid runtime key into platform and applicationId', () => {
    expect(parseRuntimeKey('discord:app123')).toEqual({
      applicationId: 'app123',
      platform: 'discord',
    });
  });

  it('should handle applicationId containing colons', () => {
    expect(parseRuntimeKey('slack:app:sub:id')).toEqual({
      applicationId: 'app:sub:id',
      platform: 'slack',
    });
  });

  it('should handle empty applicationId part', () => {
    expect(parseRuntimeKey('telegram:')).toEqual({
      applicationId: '',
      platform: 'telegram',
    });
  });

  it('should return empty platform and full string as applicationId when no colon', () => {
    expect(parseRuntimeKey('nokeyformat')).toEqual({
      applicationId: 'nokeyformat',
      platform: '',
    });
  });

  it('should be the inverse of buildRuntimeKey', () => {
    const platform = 'discord';
    const applicationId = 'my-app-123';
    const key = buildRuntimeKey(platform, applicationId);
    expect(parseRuntimeKey(key)).toEqual({ applicationId, platform });
  });
});

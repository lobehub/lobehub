import { describe, expect, it } from 'vitest';

import type { PlatformDefinition } from './types';
import {
  formatDuration,
  formatTokens,
  formatUsageStats,
  resolveBotProviderConfig,
  resolveConnectionMode,
} from './utils';

function makePlatform(overrides: Partial<PlatformDefinition> = {}): PlatformDefinition {
  return {
    clientFactory: {} as any,
    connectionMode: 'websocket',
    id: 'slack',
    name: 'Slack',
    schema: [
      {
        key: 'settings',
        label: 'Settings',
        properties: [
          { default: 'websocket', key: 'connectionMode', type: 'string' },
          { default: 4000, key: 'charLimit', type: 'number' },
        ],
        type: 'object',
      },
    ] as any,
    ...overrides,
  };
}

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

describe('resolveBotProviderConfig', () => {
  it('applies schema defaults when settings field is missing', () => {
    const result = resolveBotProviderConfig(makePlatform(), {
      applicationId: 'app-1',
      credentials: { botToken: 't' },
      settings: null,
    });

    expect(result.settings.connectionMode).toBe('websocket');
    expect(result.settings.charLimit).toBe(4000);
    expect(result.connectionMode).toBe('websocket');
    expect(result.config).toEqual({
      applicationId: 'app-1',
      credentials: { botToken: 't' },
      platform: 'slack',
      settings: { charLimit: 4000, connectionMode: 'websocket' },
    });
  });

  it('user settings override schema defaults', () => {
    const result = resolveBotProviderConfig(makePlatform(), {
      applicationId: 'app-2',
      credentials: { botToken: 't' },
      settings: { connectionMode: 'webhook' },
    });

    expect(result.settings.connectionMode).toBe('webhook');
    expect(result.settings.charLimit).toBe(4000);
    expect(result.connectionMode).toBe('webhook');
  });
});

describe('resolveConnectionMode', () => {
  it('returns schema default when raw settings have no mode (slack)', () => {
    expect(resolveConnectionMode(makePlatform(), null)).toBe('websocket');
    expect(resolveConnectionMode(makePlatform(), undefined)).toBe('websocket');
    expect(resolveConnectionMode(makePlatform(), {})).toBe('websocket');
  });

  it('returns user-set value when present', () => {
    expect(resolveConnectionMode(makePlatform(), { connectionMode: 'webhook' })).toBe('webhook');
  });

  it('falls back to webhook when platform definition is missing', () => {
    expect(resolveConnectionMode(undefined, null)).toBe('webhook');
    expect(resolveConnectionMode(undefined, { connectionMode: 'websocket' })).toBe('websocket');
  });
});

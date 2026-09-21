import { DEFAULT_BOT_DEBOUNCE_MS } from '@lobechat/const';
import { describe, expect, it } from 'vitest';

import type { PlatformDefinition } from './types';
import {
  formatDuration,
  formatTokens,
  formatUsageStats,
  resolveBotConcurrency,
  resolveBotProviderConfig,
  resolveConnectionMode,
  withResolvedConcurrencySettings,
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

describe('resolveBotConcurrency', () => {
  // WeChat splits one logical turn across several messages, so it collects a
  // window before the first dispatch. Everything else dispatches at once and
  // merges whatever arrives while the handler runs.
  it('collects a burst on WeChat when the channel has no stored strategy', () => {
    expect(resolveBotConcurrency('wechat', {})).toEqual({
      debounceMs: DEFAULT_BOT_DEBOUNCE_MS,
      strategy: 'burst',
    });
  });

  it('rescues a WeChat channel created before burst existed', () => {
    // Older channels persisted `concurrency: queue` + the old 5s window
    // when they were created, so a schema default alone would never reach
    // them. The stored window goes with it: it is hidden and unused under
    // `queue`, and 5s in front of every reply reads as a dead bot.
    expect(resolveBotConcurrency('wechat', { concurrency: 'queue', debounceMs: 5000 })).toEqual({
      debounceMs: DEFAULT_BOT_DEBOUNCE_MS,
      strategy: 'burst',
    });
  });

  it('leaves an explicit WeChat debounce exactly as the operator set it', () => {
    expect(
      resolveBotConcurrency('wechat', { concurrency: 'debounce', debounceMs: 15_000 }),
    ).toEqual({ debounceMs: 15_000, strategy: 'debounce' });
  });

  it('keeps the plain queue on platforms that send media with its caption', () => {
    expect(resolveBotConcurrency('telegram', { concurrency: 'queue', debounceMs: 5000 })).toEqual({
      debounceMs: 5000,
      strategy: 'queue',
    });
    expect(resolveBotConcurrency('telegram', {})).toEqual({
      debounceMs: DEFAULT_BOT_DEBOUNCE_MS,
      strategy: 'queue',
    });
  });

  it('honours burst and debounce wherever they were chosen', () => {
    expect(resolveBotConcurrency('telegram', { concurrency: 'burst', debounceMs: 1200 })).toEqual({
      debounceMs: 1200,
      strategy: 'burst',
    });
    expect(resolveBotConcurrency('slack', { concurrency: 'debounce' })).toEqual({
      debounceMs: DEFAULT_BOT_DEBOUNCE_MS,
      strategy: 'debounce',
    });
  });

  it('falls back to the queue for missing or nonsensical stored values', () => {
    expect(resolveBotConcurrency('discord', undefined).strategy).toBe('queue');
    expect(resolveBotConcurrency('discord', { concurrency: 'nonsense' }).strategy).toBe('queue');
    // A zero or negative window would make the SDK dispatch with no wait.
    expect(resolveBotConcurrency('discord', { concurrency: 'burst', debounceMs: 0 })).toEqual({
      debounceMs: DEFAULT_BOT_DEBOUNCE_MS,
      strategy: 'burst',
    });
  });
});

describe('withResolvedConcurrencySettings', () => {
  it('shows a legacy WeChat channel the strategy the runtime will actually use', () => {
    // Rendering the stored `queue` raw would put a value in the picker that the
    // platform no longer offers, and saving the untouched form would persist
    // the stale 5s window next to a strategy that DOES read it.
    expect(
      withResolvedConcurrencySettings('wechat', {
        charLimit: 2000,
        concurrency: 'queue',
        debounceMs: 5000,
      }),
    ).toEqual({ charLimit: 2000, concurrency: 'burst', debounceMs: DEFAULT_BOT_DEBOUNCE_MS });
  });

  it('passes through every channel the runtime does not override', () => {
    const telegram = { concurrency: 'queue', debounceMs: 5000 };
    expect(withResolvedConcurrencySettings('telegram', telegram)).toBe(telegram);

    const wechatBurst = { concurrency: 'burst', debounceMs: 1200 };
    expect(withResolvedConcurrencySettings('wechat', wechatBurst)).toBe(wechatBurst);

    const wechatDebounce = { concurrency: 'debounce', debounceMs: 15_000 };
    expect(withResolvedConcurrencySettings('wechat', wechatDebounce)).toBe(wechatDebounce);
  });

  it('leaves settings without a stored strategy alone', () => {
    const bare = { charLimit: 2000 };
    expect(withResolvedConcurrencySettings('wechat', bare)).toBe(bare);
    expect(withResolvedConcurrencySettings('wechat', undefined)).toBeUndefined();
  });
});

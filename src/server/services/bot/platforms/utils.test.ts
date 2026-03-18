import { describe, expect, it } from 'vitest';

import { formatDuration, formatTokens, formatUsageStats } from './utils';

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

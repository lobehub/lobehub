import type { ModelUsage } from '@lobechat/types';
import { describe, expect, it } from 'vitest';

import { formatMessageCostUsd, resolveMessageCost } from './resolveMessageCost';

describe('resolveMessageCost', () => {
  it('prefers usage.cost over legacy metadata.cost', () => {
    expect(resolveMessageCost({ cost: 0.42 } as ModelUsage, { cost: 1.5 })).toBe(0.42);
  });

  it('falls back to metadata.cost', () => {
    expect(resolveMessageCost(undefined, { cost: 0.15 })).toBe(0.15);
  });

  it('returns undefined when missing', () => {
    expect(resolveMessageCost(undefined, undefined)).toBeUndefined();
  });

  it('ignores non-finite values', () => {
    expect(resolveMessageCost({ cost: Number.NaN } as ModelUsage, undefined)).toBeUndefined();
    expect(resolveMessageCost(undefined, { cost: Number.POSITIVE_INFINITY })).toBeUndefined();
  });
});

describe('formatMessageCostUsd', () => {
  it('formats to two decimal places with a dollar sign', () => {
    expect(formatMessageCostUsd(0.37)).toBe('$0.37');
    expect(formatMessageCostUsd(1)).toBe('$1.00');
  });
});

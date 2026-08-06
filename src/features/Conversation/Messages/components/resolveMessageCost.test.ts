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
  it('keeps at least two decimals for typical amounts', () => {
    expect(formatMessageCostUsd(0.37)).toBe('$0.37');
    expect(formatMessageCostUsd(1)).toBe('$1.00');
  });

  it('preserves micro-USD precision for small OpenRouter charges', () => {
    expect(formatMessageCostUsd(0.00015)).toBe('$0.00015');
    expect(formatMessageCostUsd(0.0042)).toBe('$0.0042');
  });

  it('trims trailing zeros beyond two places', () => {
    expect(formatMessageCostUsd(0.12)).toBe('$0.12');
    expect(formatMessageCostUsd(1.23)).toBe('$1.23');
  });
});

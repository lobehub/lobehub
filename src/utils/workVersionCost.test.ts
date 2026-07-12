import { describe, expect, it } from 'vitest';

import { formatWorkVersionCost } from './workVersionCost';

describe('formatWorkVersionCost', () => {
  it('hides missing or zero cost', () => {
    expect(formatWorkVersionCost(null)).toBeNull();
    expect(formatWorkVersionCost(0)).toBeNull();
  });

  it('keeps small cumulative costs visible', () => {
    expect(formatWorkVersionCost(0.000_295)).toBe('$0.0003');
    expect(formatWorkVersionCost(0.03)).toBe('$0.03');
  });
});

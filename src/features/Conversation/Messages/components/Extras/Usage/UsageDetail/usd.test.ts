import { describe, expect, it } from 'vitest';

import { createUsdFormatter, formatUsdDigits, getUsdDigits } from './usd';

describe('getUsdDigits', () => {
  it('uses cents when every amount fits in two decimals', () => {
    expect(getUsdDigits([3, 15, 0.3, 3.75])).toBe(2);
  });

  it('uses the most decimals any amount needs, up to four', () => {
    expect(getUsdDigits([0.075, 0.3])).toBe(3);
    expect(getUsdDigits([0.0012, 0.01, 0.0113])).toBe(4);
    expect(getUsdDigits([0.123456])).toBe(4);
  });

  it('keeps four decimals for an amount below the finest step so it does not read as free', () => {
    expect(getUsdDigits([0.00001, 0.5])).toBe(4);
  });

  it('ignores values that are not finite', () => {
    // A model without a rate leaves a non-numeric cost behind
    expect(getUsdDigits(['-' as unknown as number, Number.NaN, 0.25])).toBe(2);
    expect(getUsdDigits([])).toBe(2);
  });
});

describe('formatUsdDigits', () => {
  it('pads every amount to the same decimals', () => {
    expect(formatUsdDigits(0.01, 4)).toBe('$0.0100');
    expect(formatUsdDigits(0.0012, 4)).toBe('$0.0012');
    expect(formatUsdDigits(3, 2)).toBe('$3.00');
  });

  it('groups thousands', () => {
    expect(formatUsdDigits(1234.5, 2)).toBe('$1,234.50');
  });

  it('shows zero as a measured amount, not as empty', () => {
    expect(formatUsdDigits(0, 2)).toBe('$0.00');
    expect(formatUsdDigits(0, 4)).toBe('$0.0000');
  });

  it('reads a positive amount below the step as less than the step', () => {
    expect(formatUsdDigits(0.00001, 4)).toBe('<$0.0001');
    expect(formatUsdDigits(0.001, 2)).toBe('<$0.01');
    expect(formatUsdDigits(-0.00001, 4)).toBe('-<$0.0001');
  });

  it('marks negative amounts', () => {
    expect(formatUsdDigits(-1.5, 2)).toBe('-$1.50');
  });

  it('leaves the symbol out when the surrounding copy carries it', () => {
    expect(formatUsdDigits(3, 2, { withSymbol: false })).toBe('3.00');
    expect(formatUsdDigits(0.00001, 4, { withSymbol: false })).toBe('<0.0001');
  });

  it('reads an empty value as --', () => {
    expect(formatUsdDigits(Number.NaN, 2)).toBe('--');
    expect(formatUsdDigits('-' as unknown as number, 2)).toBe('--');
    expect(formatUsdDigits(Number.POSITIVE_INFINITY, 2)).toBe('--');
  });
});

describe('createUsdFormatter', () => {
  it('formats a whole panel with one number of decimals', () => {
    const format = createUsdFormatter([0.0012, 0.01, 0.0113]);

    expect([0.0012, 0.01, 0.0113].map(format)).toEqual(['$0.0012', '$0.0100', '$0.0113']);
  });

  it('keeps cents when nothing needs more', () => {
    const format = createUsdFormatter([0.25, 1.5]);

    expect(format(0.25)).toBe('$0.25');
    expect(format(1.5)).toBe('$1.50');
  });
});

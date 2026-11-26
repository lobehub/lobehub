import { describe, expect, it } from 'vitest';

import { matchesWidth, parseWidthCondition, partitionWidths } from './conditionPartitions';

describe('tokenized width conditions', () => {
  it.each([
    ['(max-width: 600px)', 600, true],
    ['(width < 600px)', 600, false],
    ['(600px <= width)', 600, true],
    ['(599.2px < width <= 599.4px)', 599.3, true],
    ['card (width > 500px) and (width < 700px)', 600, true],
  ] as const)('evaluates %s at %s', (text, width, expected) => {
    expect(matchesWidth(parseWidthCondition(text)!, width)).toBe(expected);
  });
  it.each([
    'not (width > 600px)',
    '(width > 600px) or (width < 300px)',
    '(width > 30em)',
    'style(--x: red)',
    '(height: 600px)',
    '(width: 2px) and',
    '(width: 2px',
    '(color)',
    'screen and (width > 600px)',
  ])('retains unsupported syntax as a gap: %s', (query) => {
    expect(parseWidthCondition(query)).toBeUndefined();
  });
  it('partitions close decimal boundaries with an interior instead of ±1 guesses', () => {
    const conditions = [
      parseWidthCondition('(width < 599.2px)')!,
      parseWidthCondition('(width > 599.4px)')!,
    ];
    const widths = partitionWidths(conditions, 320, 920);
    expect(widths).toContain(599.3);
    expect(widths).toContain(599.2);
    expect(widths).toContain(599.4);
    expect(() => partitionWidths(conditions, 920, 320)).toThrow('INVALID_WIDTH_DOMAIN');
  });
});

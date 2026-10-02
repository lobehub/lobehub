import { describe, expect, it } from 'vitest';

import { pickToolResultUsage } from './toolResultControl';

describe('tool result usage projection', () => {
  it('keeps finite billing facts only', () => {
    expect(
      pickToolResultUsage({
        totalCost: 0.25,
        totalTokens: 42,
        totalToolCalls: 2,
        totalInputTokens: Infinity,
        totalOutputTokens: 'secret',
        images: ['secret'],
        text: 'secret',
      }),
    ).toEqual({ totalCost: 0.25, totalTokens: 42, totalToolCalls: 2 });
  });
  it.each([null, undefined, 'secret', []])('does not expose malformed state %j', (value) => {
    expect(pickToolResultUsage(value)).toEqual({});
  });
});

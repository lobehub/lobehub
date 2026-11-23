import { expect, it } from 'vitest';

import { stripMemberTokenUsage } from './stripMemberTokenUsage';

it('removes nested and legacy token metrics while preserving charges and timing', () => {
  const metadata = {
    activeColumn: true,
    accessToken: 'an unrelated metadata field',
    performance: { tps: 789, ttft: 12 },
    totalTokens: 123,
    tps: 456,
    usage: { cost: 0.0312, credits: 4, inputCachedTokens: 567, outputReasoningTokens: 345 },
  };
  expect(stripMemberTokenUsage(metadata)).toEqual({
    activeColumn: true,
    accessToken: 'an unrelated metadata field',
    performance: { ttft: 12 },
    usage: { cost: 0.0312, credits: 4 },
  });
  expect(metadata.usage.inputCachedTokens).toBe(567);
});

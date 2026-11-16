import { describe, expect, it } from 'vitest';

import { getGenerateObjectResponsesReasoningParams } from './generateObject';

describe('getGenerateObjectResponsesReasoningParams', () => {
  // GPT-6.1 Terra accepts the none effort; GPT-6.1 Sol rejects it, so the API default stays.
  it.each([
    ['gpt-6.1-terra', { reasoning: { effort: 'none' } }],
    ['gpt-6.1-sol', {}],
  ])('maps disabled thinking for %s', (model, expected) => {
    const thinking = { budget_tokens: 0, type: 'disabled' as const };

    expect(getGenerateObjectResponsesReasoningParams({ model, thinking })).toEqual(expected);
  });
});

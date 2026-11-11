import { describe, expect, it } from 'vitest';

import { getGenerateObjectResponsesReasoningParams } from './generateObject';

describe('getGenerateObjectResponsesReasoningParams', () => {
  const thinkingOff = { budget_tokens: 0, type: 'disabled' as const };

  it('sends the none effort for GPT-6.1 Terra when thinking is disabled', () => {
    expect(
      getGenerateObjectResponsesReasoningParams({ model: 'gpt-6.1-terra', thinking: thinkingOff }),
    ).toEqual({ reasoning: { effort: 'none' } });
  });

  it('leaves the effort to the API for GPT-6.1 Sol, which rejects none', () => {
    expect(
      getGenerateObjectResponsesReasoningParams({ model: 'gpt-6.1-sol', thinking: thinkingOff }),
    ).toEqual({});
  });
});

import { describe, expect, it } from 'vitest';

import { shouldShowReasoningAboveError } from './reasoningAboveError';

describe('shouldShowReasoningAboveError', () => {
  it('keeps reasoning streamed before an error that cut the turn short', () => {
    expect(
      shouldShowReasoningAboveError({
        hasEmptyErrorMessage: true,
        reasoning: { content: 'Thinking about the plan' },
      }),
    ).toBe(true);
  });

  it('leaves reasoning to the message body when the error card is not the only content', () => {
    expect(
      shouldShowReasoningAboveError({
        hasEmptyErrorMessage: false,
        reasoning: { content: 'Thinking about the plan' },
      }),
    ).toBe(false);
  });

  it('renders nothing extra when no reasoning was streamed', () => {
    expect(shouldShowReasoningAboveError({ hasEmptyErrorMessage: true })).toBe(false);
    expect(
      shouldShowReasoningAboveError({ hasEmptyErrorMessage: true, reasoning: { content: '  ' } }),
    ).toBe(false);
  });
});

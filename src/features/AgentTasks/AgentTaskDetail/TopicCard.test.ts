import { describe, expect, it } from 'vitest';

import { shouldShowRunFollowUp } from './shouldShowRunFollowUp';

describe('shouldShowRunFollowUp', () => {
  it('hides the follow-up action while the topic is running', () => {
    expect(shouldShowRunFollowUp(true, true)).toBe(false);
  });

  it('shows the follow-up action after the topic stops running', () => {
    expect(shouldShowRunFollowUp(true, false)).toBe(true);
  });

  it('keeps the follow-up action hidden without permission or a task target', () => {
    expect(shouldShowRunFollowUp(false, false)).toBe(false);
  });
});

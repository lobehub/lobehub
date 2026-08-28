import { describe, expect, it } from 'vitest';

import { resolveGoalAttemptBudget } from './createGoalInput';

describe('resolveGoalAttemptBudget', () => {
  it('leaves the budget unset when the user cleared the field', () => {
    // The manifest documents `null` as "no user-specified cap". Folding it into
    // the default silently capped a supposedly uncapped goal at three attempts.
    expect(resolveGoalAttemptBudget(null)).toBeUndefined();
    expect(resolveGoalAttemptBudget(undefined)).toBeUndefined();
  });

  it('clamps a chosen value to the supported range', () => {
    expect(resolveGoalAttemptBudget(1)).toBe(2);
    expect(resolveGoalAttemptBudget(4)).toBe(4);
    expect(resolveGoalAttemptBudget(99)).toBe(10);
  });
});

import { describe, expect, it } from 'vitest';

import { resolveGoalAttemptBudget, resolveGoalScheduleConfig } from './createGoalInput';

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

describe('resolveGoalScheduleConfig', () => {
  it('leaves the schedule unset when the user cleared the field', () => {
    expect(resolveGoalScheduleConfig(null)).toBeUndefined();
    expect(resolveGoalScheduleConfig(undefined)).toBeUndefined();
    expect(resolveGoalScheduleConfig('')).toBeUndefined();
  });

  it('normalizes a valid deadline to ISO-8601', () => {
    const config = resolveGoalScheduleConfig('2026-12-31T23:59:59Z');
    expect(config?.deadline).toBe('2026-12-31T23:59:59.000Z');
  });

  it('drops an unparseable deadline instead of storing it', () => {
    // A deadline that cannot be parsed would either never fire (silently no
    // budget) or fire immediately (silently paused goal); both hide the
    // mistake from the user, so it never reaches the config.
    expect(resolveGoalScheduleConfig('not a date')).toBeUndefined();
  });
});

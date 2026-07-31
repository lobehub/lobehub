import { describe, expect, it } from 'vitest';

import { formatGoalDuration } from './GoalRoundTimeline';

describe('formatGoalDuration', () => {
  it('uses hours before a full day', () => {
    expect(formatGoalDuration(3_600_000)).toBe('1h');
    expect(formatGoalDuration(23 * 3_600_000)).toBe('23h');
  });

  it('switches to days after 24 hours', () => {
    expect(formatGoalDuration(34 * 3_600_000)).toBe('1.4d');
  });
});

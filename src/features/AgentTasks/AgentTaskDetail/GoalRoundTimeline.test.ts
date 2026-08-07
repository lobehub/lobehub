import { describe, expect, it } from 'vitest';

import {
  formatGoalDuration,
  goalRoundEnd,
  goalRoundWidth,
  shouldShowGoalRoundTimeline,
} from './GoalRoundTimeline';

describe('formatGoalDuration', () => {
  it('uses minutes before a full hour', () => {
    expect(formatGoalDuration(3 * 60_000)).toBe('3m');
    expect(formatGoalDuration(59 * 60_000)).toBe('59m');
  });

  it('uses hours before a full day', () => {
    expect(formatGoalDuration(3_600_000)).toBe('1h');
    expect(formatGoalDuration(23 * 3_600_000)).toBe('23h');
  });

  it('switches to days after 24 hours', () => {
    expect(formatGoalDuration(34 * 3_600_000)).toBe('1.4d');
  });
});

describe('shouldShowGoalRoundTimeline', () => {
  it('hides progress until there is more than one round', () => {
    expect(shouldShowGoalRoundTimeline(0)).toBe(false);
    expect(shouldShowGoalRoundTimeline(1)).toBe(false);
    expect(shouldShowGoalRoundTimeline(2)).toBe(true);
  });
});

describe('goalRoundWidth', () => {
  it('anchors the first round at the base width', () => {
    expect(goalRoundWidth(60_000, 60_000)).toBe(28);
  });

  it('scales a longer round proportionally', () => {
    expect(goalRoundWidth(180_000, 60_000)).toBe(84);
  });

  it('never renders narrower than the base or wider than the cap', () => {
    expect(goalRoundWidth(1000, 60_000)).toBe(28);
    expect(goalRoundWidth(60 * 60_000, 60_000)).toBe(160);
  });

  it('falls back to the base width for unusable durations', () => {
    expect(goalRoundWidth(0, 60_000)).toBe(28);
    expect(goalRoundWidth(60_000, 0)).toBe(28);
  });
});

describe('goalRoundEnd', () => {
  const now = new Date('2026-08-07T12:00:00Z').getTime();
  const settledAt = '2026-08-05T12:00:00Z';

  it('stops a settled round at its own timestamp, not the clock', () => {
    // Reopening the task two days later must not bill those days to the round.
    expect(goalRoundEnd({ status: 'passed', updatedAt: settledAt }, now)).toBe(
      new Date(settledAt).getTime(),
    );
    expect(goalRoundEnd({ status: 'failed', updatedAt: settledAt }, now)).toBe(
      new Date(settledAt).getTime(),
    );
  });

  it('runs an in-flight round up to now', () => {
    expect(goalRoundEnd({ status: 'running', updatedAt: settledAt }, now)).toBe(now);
    expect(goalRoundEnd({ status: 'verifying', updatedAt: settledAt }, now)).toBe(now);
  });

  it('falls back to now when the settled timestamp is missing or unusable', () => {
    expect(goalRoundEnd({ status: 'passed' }, now)).toBe(now);
    expect(goalRoundEnd({ status: 'passed', updatedAt: 'not-a-date' }, now)).toBe(now);
  });
});

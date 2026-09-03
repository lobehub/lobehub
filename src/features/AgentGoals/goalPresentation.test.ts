import { describe, expect, it } from 'vitest';

import { formatSpan, goalStatusKey } from './goalPresentation';

describe('goalStatusKey', () => {
  it('maps every lifecycle state to a list-vocabulary key', () => {
    expect(goalStatusKey('planning')).toBe('goalList.status.planning');
    expect(goalStatusKey('running')).toBe('goalList.status.running');
    expect(goalStatusKey('review')).toBe('goalList.status.review');
    expect(goalStatusKey('achieved')).toBe('goalList.status.achieved');
  });

  it('reads a failed goal as needing attention rather than as an error state', () => {
    expect(goalStatusKey('failed')).toBe('goalList.status.error');
  });
});

describe('formatSpan', () => {
  it('renders sub-hour spans as minutes and clamps to at least one minute', () => {
    expect(formatSpan(4 * 60_000)).toBe('4m');
    expect(formatSpan(10_000)).toBe('1m');
  });

  it('splits hour-plus spans into hours and minutes', () => {
    expect(formatSpan(71 * 60_000)).toBe('1h 11m');
  });
});

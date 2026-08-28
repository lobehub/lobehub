import { describe, expect, it } from 'vitest';

import { formatCountdown, shouldPersistFallbackAssignee } from './TaskDetailRunPauseAction';

describe('formatCountdown', () => {
  it('keeps the precise countdown for durations shorter than one day', () => {
    expect(formatCountdown((23 * 3600 + 59 * 60 + 59) * 1000)).toEqual({
      countdown: '23:59:59',
      type: 'time',
    });
  });

  it('formats durations of at least one day as days and hours', () => {
    expect(formatCountdown((2 * 86_400 + 16 * 3600 + 55 * 60 + 28) * 1000)).toEqual({
      days: 2,
      hours: 16,
      type: 'days',
    });
  });

  it('clamps expired countdowns to zero', () => {
    expect(formatCountdown(-1000)).toEqual({ countdown: '00:00', type: 'time' });
  });
});

describe('shouldPersistFallbackAssignee', () => {
  it('uses the inbox agent only when the task has no assignee', () => {
    expect(shouldPersistFallbackAssignee(null, null, 'inbox-agent')).toBe(true);
    expect(shouldPersistFallbackAssignee('agent-1', null, 'inbox-agent')).toBe(false);
    expect(shouldPersistFallbackAssignee(null, 'user-1', 'inbox-agent')).toBe(false);
    expect(shouldPersistFallbackAssignee(null, null, null)).toBe(false);
  });
});

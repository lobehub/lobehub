import { describe, expect, it } from 'vitest';

import { isStatusChoiceDisabled, toManualStatus } from './goalStatusMenu';

describe('goal status menu', () => {
  it.each(['review', 'achieved', 'canceled', 'failed'])(
    'does not offer pausing a goal that is %s',
    (status) => {
      expect(isStatusChoiceDisabled('paused', status, true)).toBe(true);
    },
  );

  it.each(['planning', 'running', 'verifying', 'paused'])('offers pausing a %s goal', (status) => {
    expect(isStatusChoiceDisabled('paused', status, true)).toBe(false);
  });

  it('only offers closing to a viewer who may manage the goal', () => {
    expect(isStatusChoiceDisabled('achieved', 'running', false)).toBe(true);
    expect(isStatusChoiceDisabled('canceled', 'running', false)).toBe(true);
    expect(isStatusChoiceDisabled('canceled', 'running', true)).toBe(false);
    // Reopening stays available: resume has no creator check.
    expect(isStatusChoiceDisabled('running', 'canceled', false)).toBe(false);
  });

  it('reads coordinator verdicts as running and leaves a failed goal unchecked', () => {
    expect(toManualStatus('review')).toBe('running');
    expect(toManualStatus('failed')).toBeUndefined();
  });
});

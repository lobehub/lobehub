import { describe, expect, it } from 'vitest';

import { goalResultStatusKey, withoutGatedGoals } from './goalResults';

const results = [
  { id: 'agt_1', title: 'Agent', type: 'agent' },
  { id: 'goal_1', status: 'running', title: 'Goal', type: 'goal' },
] as any[];

describe('withoutGatedGoals', () => {
  it('keeps goal results while the Goals lab is on', () => {
    expect(withoutGatedGoals(results, true)).toBe(results);
  });

  it('drops goal results while the Goals lab is off', () => {
    expect(withoutGatedGoals(results, false)?.map((r) => r.type)).toEqual(['agent']);
  });

  it('passes a missing response through', () => {
    expect(withoutGatedGoals(undefined, false)).toBeUndefined();
  });
});

describe('goalResultStatusKey', () => {
  it('maps failed goals to the localized needs-attention label', () => {
    expect(goalResultStatusKey('failed')).toBe('goalList.status.error');
  });

  it('uses the goal list vocabulary for other statuses', () => {
    expect(goalResultStatusKey('running')).toBe('goalList.status.running');
  });

  it('returns undefined for an unknown status', () => {
    expect(goalResultStatusKey('mystery')).toBeUndefined();
  });
});

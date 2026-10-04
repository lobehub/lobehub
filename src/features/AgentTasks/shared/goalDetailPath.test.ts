import { describe, expect, it } from 'vitest';

import { goalDetailPath } from './goalDetailPath';

describe('goalDetailPath', () => {
  it("opens the goal inside its owning agent's route", () => {
    expect(goalDetailPath('goal_1', 'agt_owner')).toBe('/agent/agt_owner/goal/goal_1');
  });

  it('falls back to the global goal route when the goal has no agent', () => {
    expect(goalDetailPath('goal_2', null)).toBe('/goal/goal_2');
  });
});

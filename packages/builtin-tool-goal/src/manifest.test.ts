import { describe, expect, it } from 'vitest';

import { GoalManifest } from './manifest';
import { GoalApiName } from './types';

describe('GoalManifest', () => {
  it('exposes only the canonical createGoal workflow', () => {
    expect(GoalManifest.identifier).toBe('lobe-goal');
    expect(GoalManifest.api.map(({ name }) => name)).toEqual([GoalApiName.createGoal]);
    // 'always' cannot be bypassed by the user's auto-run approval mode —
    // launching a goal must always pause for the user to review the acceptance plan
    expect(GoalManifest.api[0].humanIntervention).toBe('always');
    expect(GoalManifest.api[0].work).toBeUndefined();
  });
});

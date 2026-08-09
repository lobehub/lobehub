import { describe, expect, it } from 'vitest';

import { GoalManifest } from './manifest';
import { GoalApiName } from './types';

describe('GoalManifest', () => {
  it('exposes only the canonical createGoal workflow', () => {
    expect(GoalManifest.identifier).toBe('lobe-goal');
    expect(GoalManifest.api.map(({ name }) => name)).toEqual([GoalApiName.createGoal]);
    expect(GoalManifest.api[0].humanIntervention).toBe('required');
    expect(GoalManifest.api[0].work).toBeUndefined();
  });
});

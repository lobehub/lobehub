import { describe, expect, it } from 'vitest';

import { type UserState } from '@/store/user/initialState';

import { labPreferSelectors } from './labPrefer';

const stateWithLab = (lab: Record<string, boolean>) => ({ preference: { lab } }) as UserState;

describe('labPreferSelectors.enableGoals', () => {
  it('is off by default', () => {
    expect(labPreferSelectors.enableGoals(stateWithLab({}))).toBe(false);
  });

  it('keeps users who opted in under the legacy enableTopicAcceptance key', () => {
    expect(labPreferSelectors.enableGoals(stateWithLab({ enableTopicAcceptance: true }))).toBe(
      true,
    );
  });

  it('lets the new key override the legacy one', () => {
    expect(
      labPreferSelectors.enableGoals(
        stateWithLab({ enableGoals: false, enableTopicAcceptance: true }),
      ),
    ).toBe(false);
  });
});

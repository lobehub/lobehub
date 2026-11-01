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

  // This client writes both keys, while older clients write only the legacy
  // one — so when they disagree, the legacy key holds the latest choice.
  it('honours an older client turning Goals off through the legacy key', () => {
    expect(
      labPreferSelectors.enableGoals(
        stateWithLab({ enableGoals: true, enableTopicAcceptance: false }),
      ),
    ).toBe(false);
  });

  it('reads the new key when the legacy one was never written', () => {
    expect(labPreferSelectors.enableGoals(stateWithLab({ enableGoals: true }))).toBe(true);
  });
});

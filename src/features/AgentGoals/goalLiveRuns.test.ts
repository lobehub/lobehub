import { describe, expect, it } from 'vitest';

import { hasLiveGoalRuns } from './goalLiveRuns';

describe('hasLiveGoalRuns', () => {
  it('is false when nothing is running, even with nodes still active', () => {
    expect(hasLiveGoalRuns({ acceptances: undefined, runHeartbeats: undefined })).toBe(false);
    expect(
      hasLiveGoalRuns({ acceptances: { n1: { status: 'verifying' } as never }, runHeartbeats: {} }),
    ).toBe(false);
  });

  it('sees a run holding a live topic', () => {
    expect(hasLiveGoalRuns({ runHeartbeats: { n1: new Date() } })).toBe(true);
  });

  it('sees a repair running on a delivered task, which holds no live topic', () => {
    expect(hasLiveGoalRuns({ acceptances: { n1: { status: 'repairing' } as never } })).toBe(true);
    // The rollup follows the newest round, which a repair opens as `planned`.
    expect(
      hasLiveGoalRuns({
        acceptances: { n1: { id: 'a', repairing: true, status: 'planned' as never } },
      }),
    ).toBe(true);
  });
});

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { mutate } from '@/libs/swr';
import { goalKeys } from '@/libs/swr/keys';
import { userService } from '@/services/user';

import { useGoalStore } from './index';

vi.mock('@/libs/swr', () => ({
  mutate: vi.fn(),
  useClientDataSWR: vi.fn(),
}));

vi.mock('@/services/user', () => ({
  userService: { addIslandDismissals: vi.fn() },
}));

/** The optimistic updater passed for one key, applied to `data`. */
const applyUpdater = (key: unknown[], data: unknown) => {
  const call = vi
    .mocked(mutate)
    .mock.calls.find(([k, updater]) => JSON.stringify(k) === JSON.stringify(key) && updater);
  return (call![1] as (value: unknown) => unknown)(data);
};

describe('dismissIslandItems', () => {
  beforeEach(() => {
    vi.mocked(mutate).mockReset().mockResolvedValue(undefined);
    vi.mocked(userService.addIslandDismissals).mockReset().mockResolvedValue([]);
  });

  it('hides the cards at once, stores the keys on the server and re-reads the island', async () => {
    await useGoalStore
      .getState()
      .dismissIslandItems(['goal-decision:d1', 'goal-sign-off:a2', 'goal-clarify:g1:q1']);

    expect(userService.addIslandDismissals).toHaveBeenCalledWith([
      'goal-decision:d1',
      'goal-sign-off:a2',
      'goal-clarify:g1:q1',
    ]);
    expect(
      applyUpdater(goalKeys.pendingForIsland(), {
        decisions: [{ decisionId: 'd1' }, { decisionId: 'd2' }],
        signOffs: [{ acceptanceId: 'a1' }, { acceptanceId: 'a2' }],
      }),
    ).toEqual({ decisions: [{ decisionId: 'd2' }], signOffs: [{ acceptanceId: 'a1' }] });
    expect(
      applyUpdater(goalKeys.pendingClarifications(), [
        { goalId: 'g1', questions: [{ decisionId: 'q1' }] },
        { goalId: 'g2', questions: [{ decisionId: 'q2' }] },
      ]),
    ).toEqual([{ goalId: 'g2', questions: [{ decisionId: 'q2' }] }]);
    expect(mutate).toHaveBeenCalledWith(goalKeys.pendingForIsland());
    expect(mutate).toHaveBeenCalledWith(goalKeys.pendingClarifications());
  });

  it('brings the cards back when the server rejects the dismissal', async () => {
    vi.mocked(userService.addIslandDismissals).mockRejectedValue(new Error('offline'));

    await expect(useGoalStore.getState().dismissIslandItems(['goal-decision:d1'])).rejects.toThrow(
      'offline',
    );

    expect(mutate).toHaveBeenCalledWith(goalKeys.pendingForIsland());
    expect(mutate).toHaveBeenCalledWith(goalKeys.pendingClarifications());
  });

  it('does nothing without keys', async () => {
    await useGoalStore.getState().dismissIslandItems([]);

    expect(userService.addIslandDismissals).not.toHaveBeenCalled();
    expect(mutate).not.toHaveBeenCalled();
  });
});

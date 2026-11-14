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

  it('brings the cards back from the cache when the server rejects the dismissal', async () => {
    vi.mocked(userService.addIslandDismissals).mockRejectedValue(new Error('offline'));
    const island = { decisions: [{ decisionId: 'd1' }], signOffs: [] };
    const clarifications = [{ goalId: 'g1', questions: [{ decisionId: 'q1' }] }];
    vi.mocked(mutate).mockImplementation(async (key: any, updater?: any) => {
      if (typeof updater !== 'function') return;
      updater(key[0] === goalKeys.pendingForIsland()[0] ? island : clarifications);
    });

    await expect(useGoalStore.getState().dismissIslandItems(['goal-decision:d1'])).rejects.toThrow(
      'offline',
    );

    // Restored without a fetch, so it holds even while the re-read fails offline.
    expect(mutate).toHaveBeenCalledWith(goalKeys.pendingForIsland(), island, {
      revalidate: false,
    });
    expect(mutate).toHaveBeenCalledWith(goalKeys.pendingClarifications(), clarifications, {
      revalidate: false,
    });
  });

  it('resolves once the server kept the keys even if re-reading the island fails', async () => {
    vi.mocked(mutate).mockImplementation(async (_key: any, updater?: any) => {
      if (updater === undefined) throw new Error('offline');
    });
    vi.spyOn(console, 'error').mockImplementation(() => {});

    await expect(
      useGoalStore.getState().dismissIslandItems(['goal-decision:d1']),
    ).resolves.toBeUndefined();
  });

  it('does nothing without keys', async () => {
    await useGoalStore.getState().dismissIslandItems([]);

    expect(userService.addIslandDismissals).not.toHaveBeenCalled();
    expect(mutate).not.toHaveBeenCalled();
  });
});

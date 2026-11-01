import { beforeEach, describe, expect, it, vi } from 'vitest';

import { revalidateReplica } from '@/libs/replica';
import { mutate } from '@/libs/swr';
import { goalKeys } from '@/libs/swr/keys';
import { briefListResource } from '@/store/brief/slices/list/projection';
import { goalGraphResource } from '@/store/goal/projection';

import { refreshGoalAsks } from './refreshGoalAsks';

vi.mock('@/libs/replica', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  revalidateReplica: vi.fn(),
}));
vi.mock('@/libs/swr', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  mutate: vi.fn(),
}));

describe('refreshGoalAsks', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('re-reads the island, the Home inbox replica and the goal graph', async () => {
    await refreshGoalAsks('goal-1');

    expect(mutate).toHaveBeenCalledWith(goalKeys.pendingForIsland());
    // The inbox is a replica: a `brief:list` SWR prefix match never reached it,
    // so an answered sign-off stayed listed there until a reload.
    expect(revalidateReplica).toHaveBeenCalledWith(briefListResource);
    expect(revalidateReplica).toHaveBeenCalledWith(goalGraphResource, 'goal-1');
  });
});

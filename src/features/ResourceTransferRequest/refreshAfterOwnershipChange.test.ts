import { beforeEach, describe, expect, it, vi } from 'vitest';

import { agentConfigKeys, groupKeys } from '@/libs/swr/keys';

import { refreshCachesAfterOwnershipChange } from './refreshAfterOwnershipChange';

const mocks = vi.hoisted(() => ({
  globalMutate: vi.fn(),
  refreshAgentList: vi.fn(),
}));

// The regression this guards: the accept path once passed these detail keys to
// a hook-BOUND `mutate` (which treats a key as replacement data for its own
// cache). The refresh must go through the GLOBAL mutator from `@/libs/swr`.
vi.mock('@/libs/swr', () => ({ mutate: (...args: unknown[]) => mocks.globalMutate(...args) }));
vi.mock('@/store/home', () => ({
  useHomeStore: { getState: () => ({ refreshAgentList: mocks.refreshAgentList }) },
}));

describe('refreshCachesAfterOwnershipChange', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('revalidates the agent config cache via the global mutator', async () => {
    await refreshCachesAfterOwnershipChange('agent', 'agent-1');

    expect(mocks.globalMutate).toHaveBeenCalledTimes(1);
    expect(mocks.globalMutate).toHaveBeenCalledWith(agentConfigKeys.config('agent-1'));
    expect(mocks.refreshAgentList).toHaveBeenCalled();
  });

  it('revalidates the group detail cache via the global mutator', async () => {
    await refreshCachesAfterOwnershipChange('agentGroup', 'group-1');

    expect(mocks.globalMutate).toHaveBeenCalledTimes(1);
    expect(mocks.globalMutate).toHaveBeenCalledWith(groupKeys.detail('group-1'));
    expect(mocks.refreshAgentList).toHaveBeenCalled();
  });
});

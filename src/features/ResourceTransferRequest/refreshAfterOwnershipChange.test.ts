import { beforeEach, describe, expect, it, vi } from 'vitest';

import type * as ReplicaModule from '@/libs/replica';

import { refreshCachesAfterOwnershipChange } from './refreshAfterOwnershipChange';

const mocks = vi.hoisted(() => ({
  globalMutate: vi.fn(),
  refreshAgentConfig: vi.fn(),
  refreshAgentList: vi.fn(),
  revalidateReplica: vi.fn(),
}));

// The regression this guards: the accept path once passed these detail keys to
// a hook-BOUND `mutate` (which treats a key as replacement data for its own
// cache). Agent config still goes through the agent store; the group detail now
// lives behind a replica resource, so it is revalidated through that resource's
// scoped sync query instead of a global SWR key.
vi.mock('@/libs/swr', () => ({ mutate: (...args: unknown[]) => mocks.globalMutate(...args) }));
vi.mock('@/libs/replica', async (importOriginal) => {
  const actual = await importOriginal<typeof ReplicaModule>();
  return {
    ...actual,
    revalidateReplica: (...args: unknown[]) => mocks.revalidateReplica(...args),
  };
});
vi.mock('@/store/agent', () => ({
  getAgentStoreState: () => ({ internal_refreshAgentConfig: mocks.refreshAgentConfig }),
}));
vi.mock('@/store/home', () => ({
  useHomeStore: { getState: () => ({ refreshAgentList: mocks.refreshAgentList }) },
}));

describe('refreshCachesAfterOwnershipChange', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('refreshes the agent config through the agent store', async () => {
    await refreshCachesAfterOwnershipChange('agent', 'agent-1');

    expect(mocks.refreshAgentConfig).toHaveBeenCalledWith('agent-1');
    expect(mocks.globalMutate).not.toHaveBeenCalled();
    expect(mocks.revalidateReplica).not.toHaveBeenCalled();
    expect(mocks.refreshAgentList).toHaveBeenCalled();
  });

  it('revalidates the group detail replica for the handed-over group', async () => {
    await refreshCachesAfterOwnershipChange('agentGroup', 'group-1');

    expect(mocks.revalidateReplica).toHaveBeenCalledTimes(1);
    expect(mocks.revalidateReplica.mock.calls[0][1]).toBe('group-1');
    expect(mocks.revalidateReplica.mock.calls[0][0]?.name).toBe('agentGroupDetail');
    expect(mocks.refreshAgentList).toHaveBeenCalled();
  });
});

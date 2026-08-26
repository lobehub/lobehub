import type * as SwrModule from 'swr';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { shareKeys } from '@/libs/swr/keys';

const { getSharedAgentMock, mutateMock } = vi.hoisted(() => ({
  getSharedAgentMock: vi.fn(),
  mutateMock: vi.fn(),
}));

vi.mock('swr', async (importOriginal) => {
  const actual = await importOriginal<typeof SwrModule>();

  return { ...actual, mutate: mutateMock };
});

vi.mock('@/services/agentShare', () => ({
  agentShareService: { getSharedAgent: getSharedAgentMock },
}));

const { refreshSharedAgentStatus, sharedAgentSWRConfig } = await import('./useSharedAgent');

describe('sharedAgentSWRConfig', () => {
  it('does not count browser reconnects as new share visits', () => {
    expect(sharedAgentSWRConfig).toMatchObject({
      revalidateOnFocus: false,
      revalidateOnReconnect: false,
    });
  });
});

describe('refreshSharedAgentStatus', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('pushes a status-only re-check (no page-view count) into the shared SWR cache', async () => {
    getSharedAgentMock.mockResolvedValue({ budgetExhausted: false });

    await refreshSharedAgentStatus('share-1');

    expect(mutateMock).toHaveBeenCalledWith(shareKeys.agentInfo('share-1'), expect.any(Function), {
      revalidate: false,
    });

    // The fetcher handed to `mutate` must request the non-counting variant.
    const fetcher = mutateMock.mock.calls[0][1] as () => Promise<unknown>;
    await fetcher();
    expect(getSharedAgentMock).toHaveBeenCalledWith('share-1', false);
  });
});

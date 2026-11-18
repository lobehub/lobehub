/**
 * @vitest-environment happy-dom
 *
 * The community detail's "Forked from" tag reads the fork source replica
 * persisted to IndexedDB, shared with the profile header: a reload paints the
 * last confirmed source before the network answers, and an agent that is not
 * a fork never asks for one.
 */
import { renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { marketApiService } from '@/services/marketApi';
import { useDiscoverStore } from '@/store/discover';
import {
  pending,
  replicaWrapper as wrapper,
  useReplicaHarness,
} from '@/store/discover/__tests__/replicaHarness';
import { marketSelectors } from '@/store/discover/selectors';

const useForkSource = (identifier: string, isFork: boolean) => {
  const { queryKey } = useDiscoverStore((s) => s.useAgentForkSource)(identifier, isFork);
  return useDiscoverStore(marketSelectors.agentForkSource(queryKey));
};

describe('agent fork source replica', () => {
  const { persist } = useReplicaHarness('fork-source');

  it('paints the persisted fork source before the network answers', async () => {
    await persist('discoverAgentForkSource', 'forked-agent', {
      source: { identifier: 'origin-agent', name: 'Origin Agent' },
    });
    vi.spyOn(marketApiService, 'getAgentForkSource').mockImplementation(pending);

    const { result } = renderHook(() => useForkSource('forked-agent', true), { wrapper });

    await waitFor(() => expect(result.current?.name).toBe('Origin Agent'));
  });

  it('does not ask for the fork source of an agent that is not a fork', async () => {
    const getAgentForkSource = vi.spyOn(marketApiService, 'getAgentForkSource');

    const { result } = renderHook(() => useForkSource('plain-agent', false), { wrapper });

    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(result.current).toBeUndefined();
    expect(getAgentForkSource).not.toHaveBeenCalled();
  });
});

/**
 * @vitest-environment happy-dom
 *
 * The group profile's review and fork tags read Market replicas persisted to
 * IndexedDB: a reload paints the last confirmed tags before the network
 * answers, then the server answer replaces them.
 */
import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { marketApiService } from '@/services/marketApi';
import {
  deferred,
  pending,
  replicaWrapper as wrapper,
  useReplicaHarness,
} from '@/store/discover/__tests__/replicaHarness';

import { useGroupMarketTags } from './useGroupMarketTags';

vi.mock('react-router', () => ({ useParams: () => ({ gid: 'group-1' }) }));
vi.mock('@/store/agentGroup', () => ({
  useAgentGroupStore: (selector: (state: unknown) => unknown) => selector({}),
}));
vi.mock('@/store/agentGroup/selectors', () => ({
  agentGroupSelectors: { getGroupMeta: () => () => ({ marketIdentifier: 'my-group' }) },
}));

describe('useGroupMarketTags', () => {
  const { persist } = useReplicaHarness('group-market-tags');

  it('paints the persisted review state and fork source before the network answers', async () => {
    await persist('discoverMarketAgentGroupStatus', 'my-group', { latestVersionUnderReview: true });
    await persist('discoverAgentGroupForkSource', 'my-group', {
      source: { identifier: 'origin-group', name: 'Origin Group' },
    });
    vi.spyOn(marketApiService, 'getAgentGroupDetail').mockImplementation(pending);
    vi.spyOn(marketApiService, 'getAgentGroupForkSource').mockImplementation(pending);

    const { result } = renderHook(() => useGroupMarketTags(), { wrapper });

    await waitFor(() => expect(result.current.isUnderReview).toBe(true));
    await waitFor(() => expect(result.current.forkSource?.name).toBe('Origin Group'));
  });

  it('replaces the persisted review state with the server answer', async () => {
    await persist('discoverMarketAgentGroupStatus', 'my-group', { latestVersionUnderReview: true });
    const next = deferred<unknown>();
    vi.spyOn(marketApiService, 'getAgentGroupDetail').mockImplementation(() => next.promise);
    vi.spyOn(marketApiService, 'getAgentGroupForkSource').mockResolvedValue({ source: null });

    const { result } = renderHook(() => useGroupMarketTags(), { wrapper });
    await waitFor(() => expect(result.current.isUnderReview).toBe(true));

    await act(async () => next.resolve({ versions: [{ isValidated: true }] }));
    await waitFor(() => expect(result.current.isUnderReview).toBe(false));
  });
});

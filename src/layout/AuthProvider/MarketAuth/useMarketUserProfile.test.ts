/**
 * @vitest-environment happy-dom
 *
 * The viewer's Market profile is a replica persisted to IndexedDB: a reload
 * paints the last confirmed profile before the network answers. Only public
 * profile fields persist (the Market session and its tokens never enter it),
 * and an account without a Market profile drops the persisted row.
 */
import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { lambdaClient } from '@/libs/trpc/client';
import { useDiscoverStore } from '@/store/discover';
import {
  deferred,
  pending,
  replicaWrapper as wrapper,
  useReplicaHarness,
} from '@/store/discover/__tests__/replicaHarness';

import { type MarketUserProfile } from './types';
import { useMarketUserProfile } from './useMarketUserProfile';

const profile = (displayName: string): MarketUserProfile => ({
  avatarUrl: 'https://example.com/a.png',
  bannerUrl: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  description: null,
  displayName,
  id: 1,
  namespace: 'alice',
  socialLinks: null,
  type: null,
  userName: 'alice',
});

vi.mock('@/libs/trpc/client', () => ({
  lambdaClient: { market: { user: { getUserByUsername: { query: vi.fn() } } } },
}));

const getUserByUsername = () => vi.mocked(lambdaClient.market.user.getUserByUsername.query);

describe('useMarketUserProfile', () => {
  const harness = useReplicaHarness('market-profile');

  it('paints the persisted profile before the network answers, then refreshes it', async () => {
    await harness.persist('discoverMarketUserProfile', 'alice', profile('Cached Alice'));
    const next = deferred<MarketUserProfile>();
    getUserByUsername().mockImplementation(() => next.promise as never);

    const { result } = renderHook(() => useMarketUserProfile('alice'), { wrapper });

    await waitFor(() => expect(result.current.data?.displayName).toBe('Cached Alice'));

    await act(async () => next.resolve(profile('Fresh Alice')));
    await waitFor(() => expect(result.current.data?.displayName).toBe('Fresh Alice'));
  });

  it('drops the persisted profile when the account has none any more', async () => {
    await harness.persist('discoverMarketUserProfile', 'alice', profile('Cached Alice'));
    getUserByUsername().mockRejectedValue({ data: { code: 'NOT_FOUND' } });

    const { result } = renderHook(() => useMarketUserProfile('alice'), { wrapper });

    await waitFor(() => expect(result.current.data).toBeUndefined());
    await waitFor(async () =>
      expect(await harness.stored('discoverMarketUserProfile', 'alice')).toBeUndefined(),
    );
  });

  it('keeps the persisted profile when a refresh fails', async () => {
    await harness.persist('discoverMarketUserProfile', 'alice', profile('Cached Alice'));
    getUserByUsername().mockRejectedValue(new Error('network down'));

    const { result } = renderHook(() => useMarketUserProfile('alice'), { wrapper });

    await waitFor(() => expect(result.current.error).toBeInstanceOf(Error));
    expect(result.current.data?.displayName).toBe('Cached Alice');
  });

  it("never paints another identity's profile", async () => {
    await harness.persist(
      'discoverMarketUserProfile',
      'alice',
      profile('Theirs'),
      'someone-else:personal',
    );
    getUserByUsername().mockImplementation(pending as never);

    const { result } = renderHook(() => useMarketUserProfile('alice'), { wrapper });

    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(result.current.data).toBeUndefined();
  });

  it('persists the profile an edit returned', async () => {
    getUserByUsername().mockImplementation(pending as never);
    const { result } = renderHook(() => useMarketUserProfile('alice'), { wrapper });

    act(() => useDiscoverStore.getState().setMarketUserProfile('alice', profile('Edited')));

    expect(result.current.data?.displayName).toBe('Edited');
    await waitFor(async () =>
      expect(await harness.stored('discoverMarketUserProfile', 'alice')).toMatchObject({
        displayName: 'Edited',
      }),
    );
  });
});

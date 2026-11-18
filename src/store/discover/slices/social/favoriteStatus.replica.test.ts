/**
 * @vitest-environment happy-dom
 *
 * The favorite button of the MCP, agent and group detail headers reads one
 * favorite-status replica persisted to IndexedDB. A toggle lands in memory and
 * in the persisted row, so a reload paints the confirmed state; a rejected
 * toggle rolls back. Agents and groups that share an identifier keep separate
 * entries.
 */
import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { socialService } from '@/services/social';
import { useDiscoverStore } from '@/store/discover';
import {
  deferred,
  pending,
  replicaWrapper as wrapper,
  useReplicaHarness,
} from '@/store/discover/__tests__/replicaHarness';
import { socialSelectors } from '@/store/discover/selectors';

import { favoriteStatusKey } from './projection';

const AGENT_KEY = favoriteStatusKey({ identifier: 'shared-id', targetType: 'agent' });
const GROUP_KEY = favoriteStatusKey({ identifier: 'shared-id', targetType: 'agent-group' });

const useStatus = (targetType: 'agent' | 'agent-group', enabled = true) => {
  const { queryKey } = useDiscoverStore((s) => s.useFavoriteStatus)(
    targetType,
    'shared-id',
    enabled,
  );
  return useDiscoverStore(socialSelectors.favoriteStatus(queryKey));
};

describe('favorite status replica', () => {
  const harness = useReplicaHarness('favorite-status');

  it('paints the persisted status before the network answers, then refreshes it', async () => {
    await harness.persist('discoverFavoriteStatus', AGENT_KEY, { isFavorited: true });
    const next = deferred<{ isFavorited: boolean }>();
    vi.spyOn(socialService, 'checkFavoriteStatus').mockImplementation(() => next.promise);

    const { result } = renderHook(() => useStatus('agent'), { wrapper });

    await waitFor(() => expect(result.current?.isFavorited).toBe(true));
    await act(async () => next.resolve({ isFavorited: false }));
    await waitFor(() => expect(result.current?.isFavorited).toBe(false));
  });

  it('keeps an agent and a group with the same identifier apart', async () => {
    vi.spyOn(socialService, 'checkFavoriteStatus').mockImplementation(async (targetType) => ({
      isFavorited: targetType === 'agent-group',
    }));

    const { result } = renderHook(() => [useStatus('agent'), useStatus('agent-group')], {
      wrapper,
    });

    await waitFor(() => {
      expect(result.current[0]?.isFavorited).toBe(false);
      expect(result.current[1]?.isFavorited).toBe(true);
    });
  });

  it('shows nothing while the viewer is signed out of the Market', async () => {
    await harness.persist('discoverFavoriteStatus', AGENT_KEY, { isFavorited: true });
    const check = vi.spyOn(socialService, 'checkFavoriteStatus');

    const { result } = renderHook(() => useStatus('agent', false), { wrapper });

    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(result.current).toBeUndefined();
    expect(check).not.toHaveBeenCalled();
  });

  it('writes a toggle to the persisted row so a reload paints it', async () => {
    vi.spyOn(socialService, 'checkFavoriteStatus')
      .mockResolvedValueOnce({ isFavorited: false })
      .mockImplementation(pending);
    vi.spyOn(socialService, 'addFavorite').mockResolvedValue();

    const { result } = renderHook(() => useStatus('agent'), { wrapper });
    await waitFor(() => expect(result.current?.isFavorited).toBe(false));

    await act(() => useDiscoverStore.getState().setFavorite('agent', 'shared-id', true));

    expect(result.current?.isFavorited).toBe(true);
    await waitFor(async () =>
      expect(await harness.stored('discoverFavoriteStatus', AGENT_KEY)).toEqual({
        isFavorited: true,
      }),
    );
  });

  it('rolls a rejected toggle back', async () => {
    vi.spyOn(socialService, 'checkFavoriteStatus')
      .mockResolvedValueOnce({ isFavorited: true })
      .mockImplementation(pending);
    vi.spyOn(socialService, 'removeFavorite').mockRejectedValue(new Error('offline'));

    const { result } = renderHook(() => useStatus('agent'), { wrapper });
    await waitFor(() => expect(result.current?.isFavorited).toBe(true));

    await act(async () => {
      await expect(
        useDiscoverStore.getState().setFavorite('agent', 'shared-id', false),
      ).rejects.toThrow('offline');
    });

    expect(result.current?.isFavorited).toBe(true);
    expect(useDiscoverStore.getState().favoriteStatusMap[GROUP_KEY]).toBeUndefined();
  });
});

/**
 * @vitest-environment happy-dom
 */
import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useShareUsage } from './useShareUsage';

const swrState = vi.hoisted(() => ({
  data: undefined as any,
  error: undefined as unknown,
  isLoading: false,
  isValidating: false,
  mutate: vi.fn(),
}));

vi.mock('swr', () => ({ default: () => swrState }));
vi.mock('@/services/agentShare', () => ({ agentShareService: { getShareStats: vi.fn() } }));
vi.mock('@/libs/swr/keys', () => ({
  shareKeys: { agentShareStats: (agentId: string) => ['share:agentShareStats', agentId] },
}));

const stats = {
  monthlySpend: 4,
  monthlySpendLimit: 10,
  topicCount: 1,
  userViewCount: 2,
  visitorCount: 1,
};

describe('useShareUsage', () => {
  beforeEach(() => {
    swrState.data = undefined;
    swrState.error = undefined;
    swrState.isLoading = false;
  });

  // A failed roll-up used to fall through to `0 / 0 / 0`, which reads as a
  // genuine "nobody used it, nothing was spent" claim.
  it('surfaces a load error instead of zero usage when the stats request fails', () => {
    swrState.error = new Error('boom');

    const { result } = renderHook(() => useShareUsage('agent-1'));

    expect(result.current.hasLoadError).toBe(true);
    expect(result.current.data).toBeUndefined();
  });

  it('keeps showing stale stats while a revalidation fails', () => {
    swrState.data = stats;
    swrState.error = new Error('boom');

    const { result } = renderHook(() => useShareUsage('agent-1'));

    expect(result.current.hasLoadError).toBe(false);
    expect(result.current.spend).toBe(4);
  });

  // The stats payload carries its own copy of the cap under a different SWR
  // key that the owner's edits never invalidate; the live configured value
  // from the share-status cache must win so the label tracks the edit.
  it('prefers the live configured cap over the copy in the stats payload', () => {
    swrState.data = stats;

    const { result } = renderHook(() => useShareUsage('agent-1', 25));

    expect(result.current.limit).toBe(25);
  });

  it('falls back to the cap reported by the stats payload', () => {
    swrState.data = stats;

    const { result } = renderHook(() => useShareUsage('agent-1'));

    expect(result.current.limit).toBe(10);
  });
});

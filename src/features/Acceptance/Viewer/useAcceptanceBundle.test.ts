/** @vitest-environment happy-dom */
import { act, renderHook } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';

import { useAcceptanceBundle } from './useAcceptanceBundle';

const { useClientDataSWR, mutate } = vi.hoisted(() => ({
  useClientDataSWR: vi.fn(),
  mutate: vi.fn(),
}));
vi.mock('@/libs/swr', () => ({ useClientDataSWR }));
vi.mock('@/services/verify', () => ({ verifyService: { getAcceptanceBundle: vi.fn() } }));

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});

it.each(['accepted', 'closed', 'delivered'])(
  'does not poll a %s acceptance with unstarted flow definitions',
  (status) => {
    vi.useFakeTimers();
    useClientDataSWR.mockReturnValue({
      data: { acceptance: { status }, flows: [{ versions: [{ runs: [] }] }] },
      mutate,
    });
    const { unmount } = renderHook(() => useAcceptanceBundle('acceptance'));
    act(() => vi.advanceTimersByTime(10000));
    expect(mutate).not.toHaveBeenCalled();
    unmount();
  },
);

it('polls active verification and stops when the acceptance is accepted', () => {
  vi.useFakeTimers();
  const data = {
    acceptance: { status: 'verifying' },
    flows: [{ versions: [{ runs: [{ status: 'collecting_evidence' }] }] }],
  };
  useClientDataSWR.mockReturnValue({ data, mutate });
  const { rerender, unmount } = renderHook(() => useAcceptanceBundle('acceptance'));
  act(() => vi.advanceTimersByTime(5000));
  expect(mutate).toHaveBeenCalledTimes(1);
  data.acceptance.status = 'accepted';
  rerender();
  act(() => vi.advanceTimersByTime(10000));
  expect(mutate).toHaveBeenCalledTimes(1);
  unmount();
});

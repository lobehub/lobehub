/**
 * @vitest-environment happy-dom
 */
import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useGlobalStore } from '@/store/global';
import { useGoalStore } from '@/store/goal';

import { useIslandDismissals } from './useIslandDismissals';

const dismissIslandItems = vi.fn<(keys: string[]) => Promise<void>>();

const setStatus = (status: Record<string, unknown>) =>
  useGlobalStore.setState((s) => ({ isStatusInit: true, status: { ...s.status, ...status } }));

beforeEach(() => {
  dismissIslandItems.mockReset().mockResolvedValue();
  useGoalStore.setState({ dismissIslandItems } as any);
  useGlobalStore.setState((s) => ({
    isStatusInit: true,
    status: {
      ...s.status,
      dismissedIslandItemKeys: undefined,
      islandDismissalsUploaded: undefined,
    },
  }));
});

describe('useIslandDismissals', () => {
  it('sends a dismissal to the server instead of keeping it on this client', async () => {
    setStatus({ islandDismissalsUploaded: true });
    const { result } = renderHook(() => useIslandDismissals(true));

    await act(() => result.current('goal-decision:d1'));

    expect(dismissIslandItems).toHaveBeenCalledWith(['goal-decision:d1']);
    expect(useGlobalStore.getState().status.dismissedIslandItemKeys).toBeUndefined();
  });

  it('rejects when the server does not keep the dismissal', async () => {
    setStatus({ islandDismissalsUploaded: true });
    dismissIslandItems.mockRejectedValueOnce(new Error('offline'));
    const { result } = renderHook(() => useIslandDismissals(true));

    await expect(result.current('goal-decision:d1')).rejects.toThrow('offline');
  });

  it('uploads the keys this client dismissed locally before, once', async () => {
    setStatus({ dismissedIslandItemKeys: ['goal-decision:old', 'goal-sign-off:a1'] });
    const { rerender } = renderHook(() => useIslandDismissals(true));

    await waitFor(() =>
      expect(useGlobalStore.getState().status.islandDismissalsUploaded).toBe(true),
    );
    rerender();

    expect(dismissIslandItems).toHaveBeenCalledTimes(1);
    expect(dismissIslandItems).toHaveBeenCalledWith(['goal-decision:old', 'goal-sign-off:a1']);
  });

  it('retries the upload on the next launch when it fails', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    dismissIslandItems.mockRejectedValueOnce(new Error('offline'));
    setStatus({ dismissedIslandItemKeys: ['goal-decision:old'] });

    renderHook(() => useIslandDismissals(true));

    await waitFor(() => expect(dismissIslandItems).toHaveBeenCalled());
    expect(useGlobalStore.getState().status.islandDismissalsUploaded).toBeUndefined();
  });

  it('does not upload while goals are off for this user', () => {
    setStatus({ dismissedIslandItemKeys: ['goal-decision:old'] });

    renderHook(() => useIslandDismissals(false));

    expect(dismissIslandItems).not.toHaveBeenCalled();
  });
});

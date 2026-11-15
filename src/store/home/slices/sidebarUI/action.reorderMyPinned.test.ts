import { act } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useHomeStore } from '@/store/home';
import { useUserStore } from '@/store/user';

const updatePreference = vi.fn();

const setPinned = (ids: string[]) =>
  useUserStore.setState({
    updateWorkspaceUserPreference: updatePreference,
    workspaceUserPreference: { sidebarPinnedItemIds: ids },
  } as any);

const reorder = (ids: string[]) => act(() => useHomeStore.getState().reorderMyPinned(ids));

beforeEach(() => {
  updatePreference.mockReset().mockResolvedValue(undefined);
});

describe('reorderMyPinned', () => {
  it('saves the new order of the shown pins', async () => {
    setPinned(['a', 'b', 'c']);

    await reorder(['c', 'a', 'b']);

    expect(updatePreference).toHaveBeenCalledWith({ sidebarPinnedItemIds: ['c', 'a', 'b'] });
  });

  it('keeps pins that are not shown after the reordered ones', async () => {
    setPinned(['a', 'hidden', 'b', 'dangling']);

    await reorder(['b', 'a']);

    expect(updatePreference).toHaveBeenCalledWith({
      sidebarPinnedItemIds: ['b', 'a', 'hidden', 'dangling'],
    });
  });

  it('adopts a legacy private pin that lived only on its column', async () => {
    setPinned(['a']);

    await reorder(['legacy', 'a']);

    expect(updatePreference).toHaveBeenCalledWith({ sidebarPinnedItemIds: ['legacy', 'a'] });
  });

  it('skips the write when nothing moved', async () => {
    setPinned(['a', 'b']);

    await reorder(['a', 'b']);

    expect(updatePreference).not.toHaveBeenCalled();
  });

  it('sends quick successive reorders one after another, each on the previous result', async () => {
    setPinned(['a', 'b', 'c']);
    let finishFirst!: () => void;
    updatePreference.mockImplementationOnce(async ({ sidebarPinnedItemIds }) => {
      await new Promise<void>((resolve) => (finishFirst = resolve));
      useUserStore.setState({ workspaceUserPreference: { sidebarPinnedItemIds } } as any);
    });

    const first = useHomeStore.getState().reorderMyPinned(['c', 'a', 'b']);
    const second = useHomeStore.getState().reorderMyPinned(['b', 'c']);
    await vi.waitFor(() => expect(updatePreference).toHaveBeenCalledTimes(1));
    // The second write waits for the first to settle.
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(updatePreference).toHaveBeenCalledTimes(1);

    finishFirst();
    await act(() => Promise.all([first, second]));

    expect(updatePreference).toHaveBeenNthCalledWith(1, { sidebarPinnedItemIds: ['c', 'a', 'b'] });
    expect(updatePreference).toHaveBeenNthCalledWith(2, { sidebarPinnedItemIds: ['b', 'c', 'a'] });
  });

  it('still saves the next reorder after a failed one', async () => {
    setPinned(['a', 'b']);
    updatePreference.mockRejectedValueOnce(new Error('boom'));

    await expect(useHomeStore.getState().reorderMyPinned(['b', 'a'])).rejects.toThrow('boom');
    await reorder(['b', 'a']);

    expect(updatePreference).toHaveBeenCalledTimes(2);
  });
});

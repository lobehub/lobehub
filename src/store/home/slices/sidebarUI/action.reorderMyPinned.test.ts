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
});

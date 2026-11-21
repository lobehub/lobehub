import { act } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { cacheScope } from '@/libs/replica';
import { useHomeStore } from '@/store/home';
import { useUserStore } from '@/store/user';

let scope = 'user-a:ws-1';

const updatePreference = vi.fn();

const setPinned = (ids: string[], customized = true) =>
  useUserStore.setState({
    updateWorkspaceUserPreference: updatePreference,
    workspaceUserPreference: {
      sidebarPinnedItemIds: ids,
      sidebarPinnedOrderCustomized: customized,
    },
  } as any);

const reorder = (ids: string[]) => act(() => useHomeStore.getState().reorderMyPinned(ids));

beforeEach(() => {
  scope = 'user-a:ws-1';
  vi.spyOn(cacheScope, 'get').mockImplementation(() => scope);
  updatePreference.mockReset().mockResolvedValue(undefined);
});

describe('reorderMyPinned', () => {
  it('saves the new order of the shown pins', async () => {
    setPinned(['a', 'b', 'c']);

    await reorder(['c', 'a', 'b']);

    expect(updatePreference).toHaveBeenCalledWith({
      sidebarPinnedItemIds: ['c', 'a', 'b'],
      sidebarPinnedOrderCustomized: true,
    });
  });

  it('keeps pins that are not shown after the reordered ones', async () => {
    setPinned(['a', 'hidden', 'b', 'dangling']);

    await reorder(['b', 'a']);

    expect(updatePreference).toHaveBeenCalledWith({
      sidebarPinnedItemIds: ['b', 'a', 'hidden', 'dangling'],
      sidebarPinnedOrderCustomized: true,
    });
  });

  it('adopts a legacy private pin that lived only on its column', async () => {
    setPinned(['a']);

    await reorder(['legacy', 'a']);

    expect(updatePreference).toHaveBeenCalledWith({
      sidebarPinnedItemIds: ['legacy', 'a'],
      sidebarPinnedOrderCustomized: true,
    });
  });

  it('saves team pins placed among the member’s own and marks the order as theirs', async () => {
    setPinned(['mine'], false);

    // The member never rearranged before: team pins were listed after theirs.
    await reorder(['team-1', 'mine', 'team-2']);

    expect(updatePreference).toHaveBeenCalledWith({
      sidebarPinnedItemIds: ['team-1', 'mine', 'team-2'],
      sidebarPinnedOrderCustomized: true,
    });
  });

  it('keeps a pinned order longer than 200 rows, since it can hold every team pin', async () => {
    const many = Array.from({ length: 250 }, (_, i) => `team-${i}`);
    setPinned([]);

    await reorder(many);

    expect(updatePreference).toHaveBeenCalledWith({
      sidebarPinnedItemIds: many,
      sidebarPinnedOrderCustomized: true,
    });
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

    expect(updatePreference).toHaveBeenNthCalledWith(1, {
      sidebarPinnedItemIds: ['c', 'a', 'b'],
      sidebarPinnedOrderCustomized: true,
    });
    expect(updatePreference).toHaveBeenNthCalledWith(2, {
      sidebarPinnedItemIds: ['b', 'c', 'a'],
      sidebarPinnedOrderCustomized: true,
    });
  });

  it('still saves the next reorder after a failed one', async () => {
    setPinned(['a', 'b']);
    updatePreference.mockRejectedValueOnce(new Error('boom'));

    await expect(useHomeStore.getState().reorderMyPinned(['b', 'a'])).rejects.toThrow('boom');
    await reorder(['b', 'a']);

    expect(updatePreference).toHaveBeenCalledTimes(2);
  });

  it.each([
    ['another workspace', 'user-a:ws-2'],
    // Same workspace, different account: A's order must not go out on B's session.
    ['another account in the same workspace', 'user-b:ws-1'],
  ])('drops a reorder still queued after switching to %s', async (_, nextScope) => {
    setPinned(['a', 'b']);
    let finishFirst!: () => void;
    updatePreference.mockImplementationOnce(
      () => new Promise<void>((resolve) => (finishFirst = resolve)),
    );

    const first = useHomeStore.getState().reorderMyPinned(['b', 'a']);
    const second = useHomeStore.getState().reorderMyPinned(['a', 'b']);
    await vi.waitFor(() => expect(updatePreference).toHaveBeenCalledTimes(1));

    scope = nextScope;
    finishFirst();
    await act(() => Promise.all([first, second]));

    expect(updatePreference).toHaveBeenCalledTimes(1);
  });
});

import { act } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { cacheScope } from '@/libs/replica';
import { useHomeStore } from '@/store/home';
import { useUserStore } from '@/store/user';

vi.mock('@/business/client/hooks/useActiveWorkspaceId', () => ({
  getActiveWorkspaceId: vi.fn(() => 'ws-1'),
  useActiveWorkspaceId: vi.fn(() => 'ws-1'),
}));

let scope = 'user-a:ws-1';

const updatePreference = vi.fn();
const refreshPreference = vi.fn();

const setPinned = (ids: string[]) =>
  useUserStore.setState({
    refreshWorkspaceUserPreference: refreshPreference,
    updateWorkspaceUserPreference: updatePreference,
    workspaceUserPreference: { sidebarPinnedItemIds: ids },
  } as any);

const reorder = (ids: string[]) => act(() => useHomeStore.getState().reorderMyPinned(ids));

beforeEach(() => {
  scope = 'user-a:ws-1';
  vi.spyOn(cacheScope, 'get').mockImplementation(() => scope);
  updatePreference.mockReset().mockResolvedValue(undefined);
  refreshPreference.mockReset().mockResolvedValue(undefined);
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

  it('keeps a pinned order longer than 200 rows, since it is seeded with every default pin', async () => {
    const many = Array.from({ length: 250 }, (_, i) => `team-${i}`);
    setPinned([]);

    await reorder(many);

    expect(updatePreference).toHaveBeenCalledWith({ sidebarPinnedItemIds: many });
  });

  it('never pins a team pin the sidebar only previewed as pinned', async () => {
    useHomeStore.setState({ pinnedAgents: [{ id: 'team-1' }] } as any);
    setPinned(['a', 'b']);
    // The server answers that this (new) member gets no team pins.
    refreshPreference.mockImplementation(async () => {
      useUserStore.setState({
        workspaceUserPreference: { sidebarInitialized: true, sidebarPinnedItemIds: ['a', 'b'] },
      });
    });

    // The sidebar had guessed the team pin would follow the member's own.
    await reorder(['b', 'team-1', 'a']);

    expect(refreshPreference).toHaveBeenCalledTimes(1);
    expect(updatePreference).toHaveBeenCalledWith({ sidebarPinnedItemIds: ['b', 'a'] });
    useHomeStore.setState({ pinnedAgents: [] } as any);
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

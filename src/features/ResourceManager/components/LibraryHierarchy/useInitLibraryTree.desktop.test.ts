import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useElectronStore } from '@/store/electron';

import { useInitLibraryTree } from './useInitLibraryTree';

const { mockInit, resourceManagerState } = vi.hoisted(() => {
  const state = {
    libraryId: undefined as string | undefined,
    setLibraryId: (id?: string) => {
      state.libraryId = id;
    },
  };
  return { mockInit: vi.fn(), resourceManagerState: state };
});

vi.mock(
  '@/hooks/useActiveRouteParams',
  async () => await import('@/hooks/useActiveRouteParams.desktop'),
);

vi.mock('@/store/tree', () => ({
  useTreeStore: (selector: (s: { init: typeof mockInit }) => unknown) =>
    selector({ init: mockInit }),
}));

vi.mock('@/features/ResourceManager/store', () => ({
  useResourceManagerStore: (selector: (s: typeof resourceManagerState) => unknown) =>
    selector(resourceManagerState),
}));

const tab = (id: string, url: string) => ({ id, lastVisited: 0, url });

describe('useInitLibraryTree (desktop)', () => {
  beforeEach(() => {
    mockInit.mockReset();
    resourceManagerState.libraryId = undefined;
  });

  afterEach(() => {
    useElectronStore.setState({ activeTabId: null, tabs: [] });
  });

  it('follows the active tab, not the portal router the sidebar renders under', () => {
    useElectronStore.setState({
      activeTabId: 'tab-a',
      tabs: [tab('tab-a', '/resource/library/kb-a'), tab('tab-b', '/resource/library/kb-b')],
    });

    const { result } = renderHook(() => useInitLibraryTree());
    expect(result.current).toBe('kb-a');
    expect(mockInit).toHaveBeenLastCalledWith('kb-a');

    act(() => {
      useElectronStore.setState({ activeTabId: 'tab-b' });
    });

    expect(result.current).toBe('kb-b');
    expect(mockInit).toHaveBeenLastCalledWith('kb-b');
    expect(resourceManagerState.libraryId).toBe('kb-b');
  });
});

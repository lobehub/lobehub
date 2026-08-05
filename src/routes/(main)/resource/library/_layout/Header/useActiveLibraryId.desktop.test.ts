import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useElectronStore } from '@/store/electron';

import { useActiveLibraryId } from './useActiveLibraryId';

vi.mock(
  '@/hooks/useActiveRouteParams',
  async () => await import('@/hooks/useActiveRouteParams.desktop'),
);

const tab = (url: string) => ({ id: 'resource-tab', lastVisited: 0, url });

afterEach(() => {
  useElectronStore.setState({ activeTabId: null, tabs: [] });
});

describe('useActiveLibraryId (desktop)', () => {
  it('follows a library ID change in the active tab', () => {
    useElectronStore.setState({
      activeTabId: 'resource-tab',
      tabs: [tab('/resource/library/library-a')],
    });

    const { result } = renderHook(() => useActiveLibraryId());
    expect(result.current).toBe('library-a');

    act(() => {
      useElectronStore.setState({ tabs: [tab('/resource/library/library-b')] });
    });

    expect(result.current).toBe('library-b');
  });
});

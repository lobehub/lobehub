import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, type MockInstance, vi } from 'vitest';

import { PERSONAL_TAB_SCOPE } from '@/features/Electron/titlebar/TabBar/scope';
import { electronSystemService } from '@/services/electron/system';
import { useElectronStore } from '@/store/electron';

import { useLastWorkspaceSlugSync } from './useLastWorkspaceSlugSync';

let setLastWorkspaceSlug: MockInstance<(slug: string | null) => Promise<void>>;

beforeEach(() => {
  setLastWorkspaceSlug = vi
    .spyOn(electronSystemService, 'setLastWorkspaceSlug')
    .mockResolvedValue();
});

afterEach(() => {
  vi.restoreAllMocks();
  useElectronStore.setState({ activeTabScope: PERSONAL_TAB_SCOPE });
});

describe('useLastWorkspaceSlugSync', () => {
  it('persists the workspace slug when the scope changes, and null back on personal', () => {
    renderHook(() => useLastWorkspaceSlugSync());
    expect(setLastWorkspaceSlug).toHaveBeenLastCalledWith(null);

    act(() => useElectronStore.setState({ activeTabScope: { slug: 'acme', type: 'workspace' } }));
    expect(setLastWorkspaceSlug).toHaveBeenLastCalledWith('acme');

    act(() => useElectronStore.setState({ activeTabScope: PERSONAL_TAB_SCOPE }));
    expect(setLastWorkspaceSlug).toHaveBeenLastCalledWith(null);
  });

  it('does not rewrite when a scope reload keeps the same slug', () => {
    useElectronStore.setState({ activeTabScope: { slug: 'acme', type: 'workspace' } });

    renderHook(() => useLastWorkspaceSlugSync());
    expect(setLastWorkspaceSlug).toHaveBeenCalledTimes(1);

    act(() => useElectronStore.setState({ activeTabScope: { slug: 'acme', type: 'workspace' } }));
    expect(setLastWorkspaceSlug).toHaveBeenCalledTimes(1);
  });
});

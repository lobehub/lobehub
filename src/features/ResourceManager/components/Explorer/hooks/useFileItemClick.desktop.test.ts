import { act, cleanup, renderHook, screen } from '@testing-library/react';
import React, { type PropsWithChildren } from 'react';
import { createMemoryRouter, MemoryRouter, useLocation } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Resolve the desktop twins of both facades. The web twins are plain
// `useLocation` / `useNavigate`, under which the pre-fix `useSearchParams` and
// the fixed facade call behave identically — only the desktop twins can tell
// them apart, because only they dispatch to the active tab's own router.
vi.mock('@/hooks/useActiveLocation', async () => await import('@/hooks/useActiveLocation.desktop'));
vi.mock(
  '@/features/Workspace/useWorkspaceAwareNavigate',
  async () => await import('@/features/Workspace/useWorkspaceAwareNavigate.desktop'),
);
// The desktop navigate twin forwards absolute string paths to `appNavigate`,
// which must also resolve to its desktop twin — the web one drives a global
// navigate ref that no test registers, so it would silently do nothing.
vi.mock(
  '@/features/Electron/navigation/appNavigate',
  async () => await import('@/features/Electron/navigation/appNavigate.desktop'),
);

const { getOrCreateTabRouter, getTabRouter, resetTabRouterManager } =
  await import('@/features/Electron/TabHost/tabRouterManager');
const { useElectronStore } = await import('@/store/electron');
const { useFileItemClick } = await import('./useFileItemClick');

const TAB_ID = 'tab-1';
const TAB_URL = '/resource/library/kb_1?view=grid';

const createRouter = (url: string) =>
  createMemoryRouter([{ element: null, path: '*' }], { initialEntries: [url] }) as any;

const ShellProbe = () =>
  React.createElement('div', { 'data-testid': 'shell-search' }, useLocation().search);

// The library sidebar is portal'd into the shell, which on desktop is a sibling
// of TabHost — so the hook renders under the shell router while the page it
// drives lives in the tab router.
const shellWrapper = ({ children }: PropsWithChildren) =>
  React.createElement(
    MemoryRouter,
    { initialEntries: ['/'] },
    React.createElement(ShellProbe),
    children,
  );

const renderFileClick = (options: Parameters<typeof useFileItemClick>[0]) =>
  renderHook(() => useFileItemClick(options), { wrapper: shellWrapper });

const setupActiveTab = (url: string) => {
  resetTabRouterManager();
  useElectronStore.setState({
    activeTabId: TAB_ID,
    tabs: [{ id: TAB_ID, lastVisited: 0, url }],
  });
  getOrCreateTabRouter(TAB_ID, url, createRouter);
};

beforeEach(() => {
  setupActiveTab(TAB_URL);
});

afterEach(() => {
  cleanup();
  resetTabRouterManager();
  useElectronStore.setState({ activeTabId: null, tabs: [] });
});

describe('useFileItemClick (desktop shell)', () => {
  it('writes ?file= to the active tab router, not the shell router', async () => {
    const { result } = renderFileClick({
      id: 'file_1',
      isFolder: false,
      isPage: false,
      libraryId: 'kb_1',
    });

    await act(async () => {
      result.current();
    });

    expect(getTabRouter(TAB_ID)!.state.location.search).toBe('?view=grid&file=file_1');
    expect(screen.getByTestId('shell-search').textContent).toBe('');
  });

  it('preserves the tab url view preferences when selecting a page', async () => {
    const { result } = renderFileClick({
      id: 'page_1',
      isFolder: false,
      isPage: true,
      libraryId: 'kb_1',
    });

    await act(async () => {
      result.current();
    });

    const search = new URLSearchParams(getTabRouter(TAB_ID)!.state.location.search);
    expect(search.get('file')).toBe('page_1');
    expect(search.get('view')).toBe('grid');
  });

  it('leaves the permission page when selecting a page from the library sidebar', async () => {
    setupActiveTab('/resource/library/kb_1/permission?view=grid');
    const { result } = renderFileClick({
      id: 'page_1',
      isFolder: false,
      isPage: true,
      libraryId: 'kb_1',
    });

    await act(async () => {
      result.current();
    });

    const { pathname, search } = getTabRouter(TAB_ID)!.state.location;
    expect(pathname).toBe('/resource/library/kb_1');
    expect(new URLSearchParams(search).get('file')).toBe('page_1');
    expect(new URLSearchParams(search).get('view')).toBe('grid');
  });

  it('drops the file param and keeps the tab router when entering a folder', async () => {
    const { result } = renderFileClick({
      id: 'folder_1',
      isFolder: true,
      libraryId: 'kb_1',
      isPage: false,
      slug: 'folder-slug',
    });

    await act(async () => {
      result.current();
    });

    const { pathname, search } = getTabRouter(TAB_ID)!.state.location;
    expect(pathname).toBe('/resource/library/kb_1/folder-slug');
    expect(new URLSearchParams(search).has('file')).toBe(false);
    expect(screen.getByTestId('shell-search').textContent).toBe('');
  });
});

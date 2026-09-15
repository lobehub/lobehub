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
const { useResourceManagerStore } = await import('@/features/ResourceManager/store');
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
  it('opens the inline detail panel without touching the tab URL', async () => {
    const { result } = renderFileClick({
      id: 'file_1',
      isFolder: false,
      isPage: false,
      libraryId: 'kb_1',
      openInPanel: true,
    });

    await act(async () => {
      result.current();
    });

    // A plain click is an in-context preview: it must not write `?file=`,
    // which doubles as the fullscreen deep-link on restore.
    expect(getTabRouter(TAB_ID)!.state.location.search).toBe('?view=grid');
    expect(screen.getByTestId('shell-search').textContent).toBe('');
    expect(useResourceManagerStore.getState().detailPanelId).toBe('file_1');
    expect(useResourceManagerStore.getState().detailPanelIsPage).toBe(false);
  });

  it('opens a page in the inline detail panel instead of the page editor', async () => {
    useResourceManagerStore.setState({ mode: 'explorer' });
    const { result } = renderFileClick({
      id: 'page_1',
      isFolder: false,
      isPage: true,
      libraryId: 'kb_1',
      openInPanel: true,
    });

    await act(async () => {
      result.current();
    });

    expect(getTabRouter(TAB_ID)!.state.location.search).toBe('?view=grid');
    expect(useResourceManagerStore.getState().mode).toBe('explorer');
    expect(useResourceManagerStore.getState().detailPanelId).toBe('page_1');
    expect(useResourceManagerStore.getState().detailPanelIsPage).toBe(true);
  });

  it('opens the page editor on double click of a page', async () => {
    const { useFileItemDoubleClick } = await import('./useFileItemClick');
    const { result } = renderHook(() => useFileItemDoubleClick({ id: 'page_1', isPage: true }), {
      wrapper: shellWrapper,
    });

    await act(async () => {
      result.current();
    });

    expect(getTabRouter(TAB_ID)!.state.location.search).toBe('?view=grid&file=page_1');
    expect(useResourceManagerStore.getState().mode).toBe('page');
    expect(useResourceManagerStore.getState().detailPanelId).toBeUndefined();
  });

  it('keeps the sidebar tree click opening the fullscreen file editor', async () => {
    useResourceManagerStore.setState({ detailPanelId: undefined, mode: 'explorer' });
    const { result } = renderFileClick({
      id: 'file_2',
      isFolder: false,
      isPage: false,
      libraryId: 'kb_1',
    });

    await act(async () => {
      result.current();
    });

    expect(getTabRouter(TAB_ID)!.state.location.search).toBe('?view=grid&file=file_2');
    expect(useResourceManagerStore.getState().mode).toBe('editor');
    expect(useResourceManagerStore.getState().detailPanelId).toBeUndefined();
  });

  it('fullscreen editor on double click writes ?file= to the tab router', async () => {
    const { result: clickResult } = renderFileClick({
      id: 'file_1',
      isFolder: false,
      isPage: false,
      libraryId: 'kb_1',
      openInPanel: true,
    });
    await act(async () => {
      clickResult.current();
    });

    const { useFileItemDoubleClick } = await import('./useFileItemClick');
    const { result } = renderHook(() => useFileItemDoubleClick({ id: 'file_1', isPage: false }), {
      wrapper: shellWrapper,
    });

    await act(async () => {
      result.current();
    });

    expect(getTabRouter(TAB_ID)!.state.location.search).toBe('?view=grid&file=file_1');
    expect(useResourceManagerStore.getState().mode).toBe('editor');
    expect(useResourceManagerStore.getState().detailPanelId).toBeUndefined();
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

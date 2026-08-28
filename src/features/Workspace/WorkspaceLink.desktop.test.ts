import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import { createMemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { TabIdContext } from '@/features/Electron/TabHost/TabIdContext';
import {
  getOrCreateTabRouter,
  resetTabRouterManager,
} from '@/features/Electron/TabHost/tabRouterManager';

const mocks = vi.hoisted(() => ({
  storeState: { activeTabId: 'active' as string | null, addNewTab: vi.fn() },
}));

vi.mock('@/store/electron', () => ({
  useElectronStore: Object.assign(
    (selector: (s: unknown) => unknown) => selector(mocks.storeState),
    { getState: () => mocks.storeState },
  ),
}));

vi.mock('./useWorkspaceAwareNavigate', () => import('./useWorkspaceAwareNavigate.desktop'));
vi.mock(
  '@/features/Electron/navigation/appNavigate',
  () => import('@/features/Electron/navigation/appNavigate.desktop'),
);

const { default: WorkspaceLink } = await import('./WorkspaceLink.desktop');

const makeRouter = (url: string) =>
  createMemoryRouter([{ element: null, path: '*' }], { initialEntries: [url] });

const seedRouter = (tabId: string) => {
  const router = getOrCreateTabRouter(tabId, '/', makeRouter);
  return vi.spyOn(router, 'navigate').mockResolvedValue(undefined);
};

afterEach(() => {
  cleanup();
  resetTabRouterManager();
  vi.restoreAllMocks();
  mocks.storeState.activeTabId = 'active';
});

describe('WorkspaceLink (desktop)', () => {
  it('navigates the active tab router on plain click in shell context', () => {
    const activeNavigate = seedRouter('active');

    render(React.createElement(WorkspaceLink, { to: '/settings' }, 'settings'));

    const link = screen.getByText('settings');
    expect(link).toHaveAttribute('href', '/settings');

    fireEvent.click(link);

    expect(activeNavigate).toHaveBeenCalledWith('/settings', {});
  });

  it('navigates the originating tab router when TabIdContext is present, not the active tab', () => {
    const activeNavigate = seedRouter('active');
    const originNavigate = seedRouter('origin');

    render(
      React.createElement(
        TabIdContext,
        { value: 'origin' },
        React.createElement(WorkspaceLink, { to: '/agent/x/tasks' }, 'tasks'),
      ),
    );

    fireEvent.click(screen.getByText('tasks'));

    expect(originNavigate).toHaveBeenCalledWith('/agent/x/tasks', {});
    expect(activeNavigate).not.toHaveBeenCalled();
  });

  it('does not touch any router on modifier click', () => {
    const activeNavigate = seedRouter('active');

    render(React.createElement(WorkspaceLink, { to: '/settings' }, 'settings'));

    const link = screen.getByText('settings');
    fireEvent.click(link, { metaKey: true });
    fireEvent.click(link, { ctrlKey: true });
    fireEvent.click(link, { shiftKey: true });
    fireEvent.click(link, { button: 1 });

    expect(activeNavigate).not.toHaveBeenCalled();
  });
});

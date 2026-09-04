/**
 * @vitest-environment happy-dom
 */
import { act, render, screen } from '@testing-library/react';
import { createElement as h, type ReactNode } from 'react';
import { createMemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';

import ActiveTabRouterStoreProvider from '@/features/Electron/TabHost/ActiveTabRouterStoreProvider';
import {
  getOrCreateTabRouter,
  resetTabRouterManager,
} from '@/features/Electron/TabHost/tabRouterManager';
import { useElectronStore } from '@/store/electron';

vi.mock('../../hooks/useCategory', () => ({
  SettingsGroupKey: { General: 'general' },
  useCategory: () => [
    {
      items: [
        { icon: () => null, key: 'profile', label: 'Profile' },
        { icon: () => null, key: 'appearance', label: 'Appearance' },
      ],
      key: 'general',
      title: 'General',
    },
  ],
}));

vi.mock('@/features/SettingsSearch', () => ({
  getTabUrl: (tab: string) => `/settings/${tab}`,
  SearchSection: ({ children }: { children?: ReactNode }) => h('div', null, children),
}));

vi.mock('@/features/Workspace/useWorkspaceAwareNavigate', () => ({
  useWorkspaceAwareNavigate: () => vi.fn(),
}));

vi.mock('@/features/NavPanel/components/NavItem', () => ({
  default: ({ active, title }: { active?: boolean; title: ReactNode }) =>
    h('button', { 'data-active': String(!!active), 'type': 'button' }, title),
}));

vi.mock('react-router', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  Link: ({ children }: { children?: ReactNode }) => h('span', null, children),
}));

const tab = (id: string, url: string) => ({ id, lastVisited: 0, url });
const createRouter = (url: string) =>
  createMemoryRouter([{ element: null, path: '/settings/:tab' }], { initialEntries: [url] });

const activeStateOf = (label: string) =>
  screen.getByText(label).closest('button')?.getAttribute('data-active');

afterEach(() => {
  resetTabRouterManager();
  useElectronStore.setState({ activeTabId: null, tabs: [] });
});

describe('settings sidebar active tab (desktop)', () => {
  it('follows the active tab url via the electron store mirror', async () => {
    useElectronStore.setState({
      activeTabId: 't1',
      tabs: [tab('t1', '/settings/profile'), tab('t2', '/settings/appearance')],
    });
    getOrCreateTabRouter('t1', '/settings/profile', createRouter);
    getOrCreateTabRouter('t2', '/settings/appearance', createRouter);

    const { default: Body } = await import('./index');
    render(h(ActiveTabRouterStoreProvider, null, h(Body)));

    expect(activeStateOf('Profile')).toBe('true');
    expect(activeStateOf('Appearance')).toBe('false');

    act(() => useElectronStore.setState({ activeTabId: 't2' }));

    expect(activeStateOf('Profile')).toBe('false');
    expect(activeStateOf('Appearance')).toBe('true');
  });
});

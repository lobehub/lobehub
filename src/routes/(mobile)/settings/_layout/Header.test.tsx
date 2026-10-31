// @vitest-environment happy-dom
import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import Header from './Header';

const navigateMock = vi.fn();

vi.mock('@/features/Workspace/useWorkspaceAwareNavigate', () => ({
  useWorkspaceAwareNavigate: () => navigateMock,
}));

vi.mock('@/hooks/useShowMobileWorkspace', () => ({ useShowMobileWorkspace: () => false }));

vi.mock('@/store/agent', () => ({
  useAgentStore: (selector: (state: { activeAgentId?: string }) => unknown) => selector({}),
}));

const renderHeader = (tab: string) =>
  render(
    <MemoryRouter initialEntries={[`/acme/settings/${tab}`]}>
      <Header />
    </MemoryRouter>,
  );

beforeEach(() => {
  navigateMock.mockClear();
});

describe('mobile settings Header', () => {
  it.each([
    ['general', 'setting:workspaceSetting.tab.general'],
    ['members', 'setting:workspaceSetting.tab.members'],
    ['plans', 'subscription:tab.plans'],
    ['billing', 'subscription:tab.billing'],
    ['credits', 'subscription:tab.credits'],
    ['devices', 'setting:tab.devices'],
    ['service-model', 'setting:tab.serviceModel'],
    ['chat-preference', 'setting:tab.chatPreference'],
    // No explicit entry: the kebab-case slug maps onto the camelCase key.
    ['subscription-accounts', 'setting:tab.subscriptionAccounts'],
    ['oauth-apps', 'auth:tab.oauthApps'],
  ])('resolves the workspace %s title', (tab, title) => {
    renderHeader(tab);

    expect(within(screen.getByRole('banner')).getByText(title)).toBeInTheDocument();
  });

  it('recognizes a query-selected workspace provider and titles it', () => {
    render(
      <MemoryRouter initialEntries={['/acme/settings/provider?active=provider&provider=openai']}>
        <Header />
      </MemoryRouter>,
    );

    expect(within(screen.getByRole('banner')).getByText('openai')).toBeInTheDocument();
  });

  it('goes back to the workspace provider list from a query-selected provider', () => {
    render(
      <MemoryRouter initialEntries={['/acme/settings/provider?active=provider&provider=openai']}>
        <Header />
      </MemoryRouter>,
    );

    fireEvent.click(within(screen.getByRole('banner')).getByRole('button'));

    // Workspace-aware navigate without `escape` keeps the `/acme` prefix, so the
    // user lands on the workspace provider list instead of personal settings.
    expect(navigateMock).toHaveBeenCalledWith('/settings/provider');
  });

  it.each([
    ['statistics', 'auth:tab.stats'],
    ['credential', 'setting:tab.creds'],
    ['skill', 'setting:workspaceSetting.tab.skill'],
    ['connector', 'setting:workspaceSetting.tab.connector'],
  ])('titles the workspace %s tab mobile now mounts', (tab, title) => {
    renderHeader(tab);

    expect(within(screen.getByRole('banner')).getByText(title)).toBeInTheDocument();
  });

  it('titles a personal tab served by a static route (no `:tab` param)', () => {
    render(
      <MemoryRouter initialEntries={['/settings/memory']}>
        <Routes>
          <Route element={<Header />} path={'/settings/memory'} />
        </Routes>
      </MemoryRouter>,
    );

    expect(within(screen.getByRole('banner')).getByText('setting:tab.memory')).toBeInTheDocument();
  });
});

describe('mobile settings Header back navigation inside a workspace', () => {
  const renderWorkspaceHeader = (pathname: string) =>
    render(
      <MemoryRouter initialEntries={[pathname]}>
        <Routes>
          <Route element={<Header />} path={'/:workspaceSlug/settings/*'} />
        </Routes>
      </MemoryRouter>,
    );

  it('goes from a workspace tab back to the workspace settings menu', () => {
    renderWorkspaceHeader('/acme/settings/members');

    fireEvent.click(within(screen.getByRole('banner')).getByRole('button'));

    expect(navigateMock).toHaveBeenCalledWith('/settings');
  });

  it('goes from the workspace settings menu back to the workspace', () => {
    renderWorkspaceHeader('/acme/settings');

    fireEvent.click(within(screen.getByRole('banner')).getByRole('button'));

    expect(navigateMock).toHaveBeenCalledWith('/');
  });
});

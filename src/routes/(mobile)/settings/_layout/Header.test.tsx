// @vitest-environment happy-dom
import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import Header from './Header';

const navigateMock = vi.fn();

vi.mock('@/features/Workspace/useWorkspaceAwareNavigate', () => ({
  useWorkspaceAwareNavigate: () => navigateMock,
}));

vi.mock('@/hooks/useShowMobileWorkspace', () => ({ useShowMobileWorkspace: () => false }));

vi.mock('@/store/session', () => ({
  useSessionStore: (selector: (state: { activeId?: string }) => unknown) => selector({}),
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
});

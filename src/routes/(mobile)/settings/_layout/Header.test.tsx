// @vitest-environment happy-dom
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { describe, expect, it, vi } from 'vitest';

import Header from './Header';

vi.mock('@/features/Workspace/useWorkspaceAwareNavigate', () => ({
  useWorkspaceAwareNavigate: () => vi.fn(),
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
});
